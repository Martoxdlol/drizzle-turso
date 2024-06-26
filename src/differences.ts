/**
 * Changes
 * - New column -> add column
 * - Mod column -> Recreate table <-- recreate tables that depend on this table (foreign keys)
 * - Del column -> Recreate table <-- recreate tables that depend on this table (foreign keys)
 * - Change, add, remove unique -> Recreate table <-- recreate tables that depend on this table (foreign keys)
 * - Add index -> add index
 * - Del index -> remove index
 * - Change index -> remove index, add index
 * - Del table -> remove table
 * 
 * WARING: I did change some things after this comment was originally written.
 * I have pending a full review of this file.
 */

import type { Column, Definitions, ForeignKey, Index, Table } from './definitions'
import {
    addColumnSQL,
    addForeignKeyToColumnSQL,
    addIndexToTableSQL,
    createTableSQL,
    recreateTableSql,
    removeColumnSQL,
    removeForeignKeyFromColumnSQL,
    removeTableSQL,
} from './sql-utils'

export type Operation = {
    title: string
    sql: string[]
}

export type DifferencesOptions = {
    creationMode: boolean
}

export function differences(
    from: Definitions,
    to: Definitions,
    options?: DifferencesOptions,
): {
    summary: PushSummary
    operations: Operation[]
} {
    if (options?.creationMode && from.tables.size > 0) {
        throw new Error('Creation mode is not supported for existing tables')
    }

    for (const t of from.tables.values()) {
        t.verify()
    }

    for (const t of to.tables.values()) {
        t.verify()
    }

    const operations: Operation[] = []

    // Tables not longer needed
    const tablesToDelete = getTablesToDelete(from, to)

    // New tables
    const tablesToAdd = getTablesToAdd(from, to)

    // New columns on existing tables
    // const columnsToAdd = getColumnsToAdd(from, to) // TODO: REVIEW THIS AND FIX BUGS
    const columnsToAdd = new Set<Column>()

    // Columns that are going to be deleted
    const columnsToDelete = getColumnsToDelete(from, to)

    // Tables that need a change that is not possible to do without recreating the table
    const { tablesToRecreate, tablesToDropReferences, recreateReasons } = getTablesToRecreate(from, to)

    // Indexes to create
    const indexesToAdd = getIndexesToAdd(from, to)

    // Indexes to remove
    const indexesToRemove = getIndexesToRemove(from, to)

    // All columns from tables that need to be recreated doesn't need to be deleted/created individually
    for (const name of tablesToRecreate) {
        const tableFrom = from.tables.get(name)!

        Array.from(tableFrom.columns.values()).forEach((v) => columnsToDelete.delete(v))
        const tableTo = to.tables.get(name)!

        Array.from(tableTo.columns.values()).forEach((v) => columnsToAdd.delete(v))

        for (const index of tableFrom.indexes.values()) {
            indexesToRemove.add(index)
        }

        for (const index of tableTo.indexes.values()) {
            indexesToAdd.add(index)
        }
    }

    for (const index of indexesToRemove) {
        operations.push({
            title: `Remove index ${index.name}`,
            sql: [`DROP INDEX \`${index.name}\``],
        })
    }

    // All Existing rows with references
    const foreignKeys = from.allSingleColumnForeignKeys()

    for (const fk of foreignKeys) {
        if (tablesToDropReferences.has(fk.ownerTable.name)) {
            operations.push({
                title: `Remove foreign key ${fk.localColumns[0]!.name} from table ${fk.ownerTable.name}`,
                sql: removeForeignKeyFromColumnSQL(fk.ownerTable.name, fk.localColumns[0]!),
            })
        }
    }

    for (const t of tablesToAdd) {
        operations.push({
            title: `Create table ${t.name}`,
            sql: createTableSQL(t, false),
        })
    }

    for (const t of tablesToDelete) {
        operations.push({
            title: `Remove table ${t.name}`,
            sql: removeTableSQL(t.name),
        })
    }

    for (const c of columnsToAdd) {
        operations.push({
            title: `Add column ${c.name} to table ${c.ownerTable.name}`,
            sql: addColumnSQL(c),
        })
    }

    for (const c of columnsToDelete) {
        operations.push({
            title: `Remove column ${c.name} from table ${c.ownerTable.name}`,
            sql: removeColumnSQL(c),
        })
    }

    for (const name of tablesToRecreate) {
        const oldTable = from.getTable(name)
        const newTable = to.getTable(name)

        operations.push({
            title: `Recreate table ${name}`,
            sql: recreateTableSql(oldTable, newTable),
        })
    }

    const toForeignKeys = to.allSingleColumnForeignKeys()

    for (const fk of toForeignKeys) {
        if (options?.creationMode) {
            break
        }

        const tableName = fk.ownerTable.name

        if (!(tablesToDropReferences.has(tableName) || tablesToAdd.has(to.getTable(tableName)))) {
            continue
        }

        operations.push({
            title: `Add foreign key ${fk.localColumns[0]!.name} to table ${fk.ownerTable.name}`,
            sql: addForeignKeyToColumnSQL(tableName, fk.localColumns[0]!, fk),
        })
    }

    for (const index of indexesToAdd) {
        operations.push({
            title: `Add index ${index.name}`,
            sql: addIndexToTableSQL(
                index.ownerTable.name,
                index.name,
                index.columns.map((c) => c.name),
            ),
        })
    }

    return {
        summary: {
            addedColumns: Array.from(columnsToAdd).map((c) => `${c.ownerTable.name}.${c.name}`),
            removedColumns: Array.from(columnsToDelete).map((c) => `${c.ownerTable.name}.${c.name}`),
            addedTables: Array.from(tablesToAdd).map((t) => t.name),
            recreatedTables: Array.from(tablesToRecreate),
            removedTables: Array.from(tablesToDelete).map((t) => t.name),
            recreateReasons,
        },
        operations,
    }
}

function getTablesToDelete(from: Definitions, to: Definitions) {
    const tablesToDelete: Table[] = []

    for (const table of from.tables.values()) {
        if (!to.tables.has(table.name)) {
            tablesToDelete.push(table)
        }
    }

    return tablesToDelete
}

function getTablesToAdd(from: Definitions, to: Definitions) {
    const tablesToAdd = new Set<Table>()

    for (const table of to.tables.values()) {
        if (!from.tables.has(table.name)) {
            tablesToAdd.add(table)
        }
    }

    return tablesToAdd
}

function getColumnsToAdd(from: Definitions, to: Definitions) {
    const cols = new Set<Column>()

    for (const tableTo of to.tables.values()) {
        const tableFrom = from.tables.get(tableTo.name)
        if (!tableFrom) {
            continue
        }

        getColumnsToAddFromTables(tableFrom, tableTo).forEach((v) => cols.add(v))
    }

    return cols
}

function getColumnsToAddFromTables(from: Table, to: Table) {
    const columnsToAdd = new Set<Column>()

    for (const column of to.columns.values()) {
        if (!from.columns.has(column.name)) {
            columnsToAdd.add(column)
        }
    }

    return columnsToAdd
}

function getColumnsToDelete(from: Definitions, to: Definitions) {
    const cols = new Set<Column>()

    for (const tableTo of to.tables.values()) {
        const tableFrom = from.tables.get(tableTo.name)
        if (!tableFrom) {
            continue
        }

        getColumnsToDeleteFromTables(tableFrom, tableTo).forEach((v) => cols.add(v))
    }

    return cols
}

function getColumnsToDeleteFromTables(from: Table, to: Table) {
    const columnsToDelete = new Set<Column>()

    for (const column of from.columns.values()) {
        if (!to.columns.has(column.name)) {
            columnsToDelete.add(column)
        }
    }

    return columnsToDelete
}

function getIndexesToAdd(from: Definitions, to: Definitions) {
    const indexesFrom = new Map(from.allIndexes().map((i) => [i.name, i]))
    const indexesTo = new Map(to.allIndexes().map((i) => [i.name, i]))

    const indexesToAdd = new Set<Index>()

    for (const [name, index] of indexesTo) {
        const indexFrom = indexesFrom.get(name)
        if (!indexFrom) {
            indexesToAdd.add(index)
        } else if (!indexesEqual(indexFrom, index)) {
            indexesToAdd.add(index)
        }
    }

    return indexesToAdd
}

function getIndexesToRemove(from: Definitions, to: Definitions) {
    const indexesFrom = new Map(from.allIndexes().map((i) => [i.name, i]))
    const indexesTo = new Map(to.allIndexes().map((i) => [i.name, i]))

    const indexesToRemove = new Set<Index>()

    for (const [name, index] of indexesFrom) {
        if (!indexesTo.has(name)) {
            indexesToRemove.add(index)
        } else if (!indexesEqual(index, indexesTo.get(name)!)) {
            indexesToRemove.add(index)
        }
    }

    return indexesToRemove
}

function primaryKeysEqual(from: Table, to: Table) {
    const pkFrom = stringifyColumnsList(from.primaryKey)
    const pkTo = stringifyColumnsList(to.primaryKey)

    return pkFrom === pkTo
}

function uniquesEqual(from: Table, to: Table) {
    return stringifyUniques(from.uniques) === stringifyUniques(to.uniques)
}

function stringifyUnique(unique: { columns: Column[] }) {
    return stringifyColumnsList(unique.columns)
}

function stringifyUniques(uniques: { columns: Column[] }[]) {
    return [...new Set(uniques.map(stringifyUnique))].sort().join(',')
}

function stringifyForeignKey(fk: ForeignKey) {
    const colsFrom = stringifyColumnsList(fk.localColumns)
    const colsTo = stringifyColumnsList(fk.foreignColumns)
    return `${colsFrom} -> ${colsTo} on ${fk.foreignTable.name} | ${fk.onDelete} | ${fk.onUpdate}`
}

function stringifyForeignKeys(fks: ForeignKey[]) {
    return [...new Set(fks.map(stringifyForeignKey))].sort().join(',')
}

function foreignKeysEqual(from: Table, to: Table) {
    return stringifyForeignKeys(from.foreignKeys) === stringifyForeignKeys(to.foreignKeys)
}

function getTablesToRecreate(from: Definitions, to: Definitions) {
    const tablesToRecreate = new Set<string>()
    const tablesToDropReferences = new Set<string>()

    const recreateReasons = new Map<string, string>()

    const references = tablesReferences(from)

    // TODO: REVIEW THIS
    const tablesToRecreateFromColumnsToAdd = new Set([...getColumnsToAdd(from, to).values()].map((c) => c.ownerTable.name))

    for (const fromTable of from.tables.values()) {
        const toTable = to.tables.get(fromTable.name)
        if (!toTable) {
            continue
        }

        const pkChanged = !primaryKeysEqual(fromTable, toTable)
        const uniquesChanged = !uniquesEqual(fromTable, toTable)
        const fksChanged = !foreignKeysEqual(fromTable, toTable)
        const hasUniqueIndexes = [...fromTable.indexes.values()].find((i) => i.unique)

        const reason = []

        for (const column of fromTable.columns.values()) {
            const toColumn = toTable.columns.get(column.name)
            if (toColumn) {
                if (column.type !== toColumn.type) {
                    reason.push(`type of column ${column.name} of table ${fromTable.name}`)
                }
                if (column.notNull !== toColumn.notNull) {
                    reason.push(`notNull of column ${column.name} of table ${fromTable.name}`)
                }
                if (column.defaultValue !== toColumn.defaultValue) {
                    reason.push(
                        `default of column ${column.name} of table ${fromTable.name} (from ${column.defaultValue} to ${toColumn.defaultValue})`,
                    )
                }
            }
        }

        if (pkChanged || uniquesChanged || fksChanged || hasUniqueIndexes || tablesToRecreateFromColumnsToAdd.has(fromTable.name)) {
            if (tablesToRecreateFromColumnsToAdd.has(fromTable.name)) {
                reason.push('added columns')
            }

            if (pkChanged) {
                reason.push('pk')
            }

            if (uniquesChanged) {
                reason.push('uniques')
            }

            if (fksChanged) {
                reason.push('fks')
            }

            if (hasUniqueIndexes) {
                reason.push('unique indexes (migrate to UNIQUE on definition)')
            }

            for (const table of references.get(fromTable.name) ?? []) {
                if (to.tables.has(table)) {
                    tablesToDropReferences.add(table)
                }
            }
        }

        if (reason.length > 0) {
            tablesToRecreate.add(fromTable.name)
            tablesToDropReferences.add(fromTable.name)
            recreateReasons.set(fromTable.name, reason.join(', '))
        }
    }

    return { tablesToRecreate, tablesToDropReferences, recreateReasons }
}

function stringifyColumnsList(columns: Column[]) {
    return columns
        .map((col) => encodeURIComponent(col.name))
        .sort()
        .join(',')
}

function indexesEqual(from: Index, to: Index) {
    return (
        from.unique === to.unique &&
        from.name === to.name &&
        from.columns.map((c) => encodeURIComponent(c.name)).join(',') === to.columns.map((c) => encodeURIComponent(c.name)).join(',')
    )
}

function tablesReferences(defs: Definitions): Map<string, Set<string>> {
    const dependencyGraph = new Map<string, Set<string>>()

    for (const table of defs.tables.values()) {
        for (const fk of table.foreignKeys) {
            const ref = dependencyGraph.get(fk.foreignTable.name) ?? new Set<string>()
            ref.add(table.name)
            dependencyGraph.set(fk.foreignTable.name, ref)
        }
    }

    return dependencyGraph
}

// function tablesReferencingColumn(defs: Definitions, col: Column) {
//     const tables = new Set<string>()
//     // for each fk of each table check if ot references col
//     for (const table of defs.tables.values()) {
//         for (const fk of table.foreignKeys) {
//             for (const fkCol of fk.foreignColumns) {
//                 if (fkCol.name === col.name) {
//                     tables.add(table.name)
//                 }
//             }
//         }
//     }
// }

export type PushSummary = {
    addedColumns: string[]
    removedColumns: string[]
    addedTables: string[]
    removedTables: string[]
    recreatedTables: string[]
    recreateReasons: Map<string, string>
}
