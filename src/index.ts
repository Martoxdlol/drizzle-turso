import type { MinimalClient } from './client'
import { Definitions } from './definitions'
import { type Operation, differences } from './differences'
import { getRemoteDefinitions } from './remote'
export * from './definitions'
export * from './drizzle'
export * from './remote'
export * from './differences'
export * from './client'
export * from './sql-utils'

export type PusherOptions = {
    /**
     * If true, it will log the operations that will be executed
     */
    log?: boolean | ((...elements: unknown[]) => void)
    /** 
     * It will ignore foreign keys and it can only create tables from scratch. 
     * 
     * It is useful for running test in local sqlite databases
     */
    localTestingMode?: boolean
    /** 
     * Only consider tables with this prefix
     */
    prefix?: string
}

export async function pushDrizzleSchema(client: MinimalClient, schema: Record<string, unknown>, options?: PusherOptions) {
    const remoteDefinitions = await getRemoteDefinitions(client, { prefix: options?.prefix })
    const fromDrizzle = Definitions.fromDrizzle(schema)

    const { operations, summary } = differences(remoteDefinitions, fromDrizzle, {
        creationMode: options?.localTestingMode ?? false,
    })

    let log: ((..._: unknown[]) => void) = console.log
    if (typeof options?.log === 'function') {
        log = options.log
    } else if (options?.log === false) {
        log = () => void 0
    }

    if (operations.length === 0) {
        if (log) {
            log('No changes to apply 😃')
        }

        return
    }

    if (log) {
        log('Add columns', summary.addedColumns)
        log('Remove columns', summary.removedColumns)
        log('Add tables', summary.addedTables)
        log('Remove tables', summary.removedTables)
        log('Recreated tables', summary.recreatedTables)
        log('Recreated tables and why', summary.recreateReasons)
        log('\n')
    }

    await runAll(client, operations, log)
}

async function runAll(client: MinimalClient, operations: Operation[], log: ((..._: unknown[]) => void)) {
    const lines = operations.flatMap((op) => op.sql)

    for (const l of lines) {
        log(l)
    }

    await client.execute('pragma foreign_keys=off')
    // It is important to run it like this because if not, it will not consider correctly the foreign pragma
    // A btach or transaction doesn't seem to work
    await client.executeMultiple(`pragma foreign_keys=off;
begin;
${lines.join(';\n')};
commit;`)
}
