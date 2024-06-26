import { type ColumnType, Definitions, ForeignKey, type ForeignKeyAction, type Table } from './definitions'
import type { MinimalClient } from './client'

export type RemoteTableColumn = {
    table_name: string
    column_name: string
    column_type: ColumnType
    column_pk: number
    column_notnull: number
    column_default: string
}

export type RemoteTableForeignKey = {
    table_name: string
    foreign_key_id: number
    foreign_key_seq: number
    foreign_key_table: string
    foreign_key_from: string
    foreign_key_to: string
    foreign_key_on_update: string
    foreign_key_on_delete: string
    foreign_key_match: string
}

export type RemoteTableIndexColumn = {
    table_name: string
    index_name: string
    index_seq: number
    index_unique: number
    index_origin: string
    index_partial: number
    index_column_name: string
    index_column_seqno: number
    index_column_cid: number
}

export type RemoteRemoteSchema = {
    tables_columns: RemoteTableColumn[]
    tables_foreign_keys: RemoteTableForeignKey[]
    tables_indexes_columns: RemoteTableIndexColumn[]
}

export async function queryRemoteSchema(client: MinimalClient, opts?: RemoteSchemaOpts): Promise<RemoteRemoteSchema> {
    const result = await client.batch([
        `select 
    pragma_table_list.name as table_name,
    pragma_table_info.name as column_name,
    pragma_table_info.type as column_type,
    pragma_table_info.pk as column_pk,
    pragma_table_info.\`notnull\` as column_notnull,
    pragma_table_info.dflt_value as column_default
    from pragma_table_list
    INNER JOIN pragma_table_info ON pragma_table_list.name = pragma_table_info.arg
    `,
        `select 
    pragma_table_list.name as table_name,
    pragma_foreign_key_list.id as foreign_key_id,
    pragma_foreign_key_list.seq as foreign_key_seq,
    pragma_foreign_key_list.\`table\` as foreign_key_table,
    pragma_foreign_key_list.\`from\` as foreign_key_from,
    pragma_foreign_key_list.\`to\` as foreign_key_to,
    pragma_foreign_key_list.\`on_update\` as foreign_key_on_update,
    pragma_foreign_key_list.\`on_delete\` as foreign_key_on_delete,
    pragma_foreign_key_list.\`match\` as foreign_key_match
    from pragma_table_list
    INNER JOIN pragma_foreign_key_list ON pragma_table_list.name = pragma_foreign_key_list.arg
    `,
        `select 
    pragma_table_list.name as table_name,
    pragma_index_list.name as index_name,
    pragma_index_list.seq as index_seq,
    pragma_index_list.\`unique\` as index_unique,
    pragma_index_list.origin as index_origin,
    pragma_index_list.partial as index_partial,
    pragma_index_info.name as index_column_name,
    pragma_index_info.seqno as index_column_seqno,
    pragma_index_info.cid as index_column_cid
    from pragma_table_list
    INNER JOIN pragma_index_list ON pragma_table_list.name = pragma_index_list.arg
    FULL JOIN pragma_index_info ON pragma_index_list.name = pragma_index_info.arg
    `,
    ])

    const out = {
        tables_columns: result[0]!.rows as unknown as RemoteTableColumn[],
        tables_foreign_keys: result[1]?.rows as unknown as RemoteTableForeignKey[],
        tables_indexes_columns: result[2]?.rows as unknown as RemoteTableIndexColumn[],
    }

    if (opts?.prefix) {
        out.tables_columns = out.tables_columns.filter((tc) => tc.table_name.startsWith(opts.prefix!))
        out.tables_foreign_keys = out.tables_foreign_keys.filter((fk) => fk.table_name.startsWith(opts.prefix!))
        out.tables_indexes_columns = out.tables_indexes_columns.filter((ic) => ic.table_name.startsWith(opts.prefix!))
    }

    return out
}

export type RemoteSchemaOpts = {
    prefix?: string
}


export async function getRemoteDefinitions(client: MinimalClient, opts?: RemoteSchemaOpts) {
    const result = await queryRemoteSchema(client, opts)

    const definitions = new Definitions()

    const tables = new Set(result.tables_columns.map((tc) => tc.table_name))

    for (const name of tables) {
        if (opts?.prefix && !name.startsWith(opts.prefix)) {
            tables.delete(name)
        }

        if (name.startsWith('sqlite_')) {
            tables.delete(name)
        }
    }

    for (const name of tables) {
        definitions.createTable(name)
    }

    for (const col of result.tables_columns) {
        if (!tables.has(col.table_name)) {
            continue
        }

        const table = definitions.getTable(col.table_name)

        table.createColumn({
            name: col.column_name,
            notNull: col.column_notnull === 1,
            type: ensureValidColumnType(col.column_type),
            unique: false,
            defaultValue: col.column_default,
        })

        if (col.column_pk > 0) {
            table.setColumnNameAsPrimaryKey(col.column_name, col.column_pk)
        }
    }

    const tablesForeignKeys = new Map<string, Map<number, ForeignKey>>()

    for (const name of tables) {
        tablesForeignKeys.set(name, new Map())
    }

    for (const fk of result.tables_foreign_keys) {
        const table = definitions.getTable(fk.table_name)
        const foreignKeys = tablesForeignKeys.get(fk.table_name)!

        let foreignTable: Table
        try {
            foreignTable = definitions.getTable(fk.foreign_key_table)
        } catch (_error) {
            console.warn(`Foreign table ${fk.foreign_key_table} not found for foreign key ${fk.foreign_key_id} at table ${fk.table_name}`)
            continue
        }

        const from = table.getColumn(fk.foreign_key_from)
        const to = foreignTable.getColumn(fk.foreign_key_to)

        const key =
            foreignKeys!.get(fk.foreign_key_id) ??
            new ForeignKey({
                localColumns: [],
                foreignColumns: [],
                foreignTable,
                onDelete: fk.foreign_key_on_delete as ForeignKeyAction,
                onUpdate: fk.foreign_key_on_update as ForeignKeyAction,
            })

        key.addColumnPair(from, to)

        foreignKeys.set(fk.foreign_key_id, key)
    }

    for (const name of tables) {
        const keys = tablesForeignKeys.get(name)!.values()

        for (const key of keys) {
            definitions.getTable(name).addForeignKey(key)
        }
    }

    const indexes = new Map<string, Map<string, RemoteTableIndexColumn[]>>()

    for (const index_column of result.tables_indexes_columns) {
        const table = indexes.get(index_column.table_name) ?? new Map<string, RemoteTableIndexColumn[]>()
        indexes.set(index_column.table_name, table)

        let index = table.get(index_column.index_name) ?? []
        index.push(index_column)

        index = index.sort((a, b) => a.index_column_seqno - b.index_column_seqno)

        table.set(index_column.index_name, index)
    }

    for (const [table_name, tableIndexes] of indexes) {
        for (const [index_name, index_columns] of tableIndexes) {
            const origin = index_columns[0]!.index_origin as 'pk' | 'u' | 'c'
            if (index_columns.length === 0 || origin === 'pk') {
                continue
            }

            const unique = index_columns[0]!.index_unique

            if (unique) {
                const table = definitions.getTable(table_name)
                const columns = index_columns.map((ic) => table.getColumn(ic.index_column_name).name)
                table.createUnique(columns)
            }

            if (origin === 'c') {
                if (index_name.startsWith('sqlite_autoindex')) {
                    continue
                }

                const table = definitions.getTable(table_name)

                table.createIndex({
                    name: index_name,
                    columns: index_columns.map((ic) => table.getColumn(ic.index_column_name).name),
                    unique: unique === 1,
                })
            }
        }
    }

    return definitions
}

export function ensureValidColumnType(str: string): ColumnType {
    const text = str.trim().toUpperCase()
    switch (text) {
        case 'TEXT':
            return 'TEXT'
        case 'INTEGER':
            return 'INTEGER'
        case 'INT':
            return 'INTEGER'
        case 'REAL':
            return 'REAL'
        case 'BLOB':
            return 'BLOB'
        case 'NULL':
            return 'NULL'
        default: {
            console.warn(`Unknown column type "${text}"`)
            return ''
        }
    }
}
