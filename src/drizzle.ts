import { SQL, getTableName } from 'drizzle-orm'
import {
    SQLiteBigInt,
    SQLiteBlobBuffer,
    SQLiteBlobJson,
    SQLiteBoolean,
    type SQLiteColumn,
    SQLiteInteger,
    SQLiteNumeric,
    SQLiteReal,
    SQLiteTable,
    SQLiteText,
    SQLiteTextJson,
    getTableConfig,
} from 'drizzle-orm/sqlite-core'
import { type ColumnType, Definitions, type ForeignKeyAction } from './definitions'

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Is not that hard!
export function definitionsFromDrizzleSchema(schema: Record<string, unknown>): Definitions {
    const definitions = new Definitions()

    const tables: SQLiteTable[] = []

    for (const key of Object.keys(schema)) {
        const table = schema[key]
        if (!(table instanceof SQLiteTable)) {
            continue
        }

        const tableName = getTableName(table)
        definitions.createTable(tableName)
        tables.push(table)
    }

    for (const table of tables) {
        const tableName = getTableName(table)

        const t = definitions.getTable(tableName)

        const config = getTableConfig(table)

        for (const column of config.columns) {
            const defaultValue = getDefaultValue(column)
            t.createColumn({
                name: column.name,
                notNull: column.notNull,
                type: getColumnType(column),
                unique: column.isUnique,
                defaultValue: defaultValue,
                // autoIncrement: column.primary
            })

            if (column.primary) {
                t.primaryKey.push(t.getColumn(column.name))
            }
        }

        for (const pk of config.primaryKeys) {
            if (t.primaryKey.length !== 0) {
                continue
            }

            t.primaryKey = pk.columns.map((c) => t.getColumn(c.name))
        }

        for (const idx of config.indexes) {
            if (idx.config.unique) {
                t.createUnique(idx.config.columns.map((c) => (c as SQLiteColumn).name))
            } else {
                t.createIndex({
                    name: idx.config.name,
                    columns: idx.config.columns.map((c) => (c as SQLiteColumn).name),
                })
            }
        }

        for (const unique of config.uniqueConstraints) {
            t.createUnique(unique.columns.map((c) => (c as SQLiteColumn).name))
        }
    }

    for (const table of tables) {
        const tableName = getTableName(table)

        const t = definitions.getTable(tableName)

        const config = getTableConfig(table)

        for (const fk of config.foreignKeys) {
            t.createForeignKey({
                foreignColumns: fk.reference().foreignColumns.map((c) => c.name),
                foreignTable: definitions.getTable(getTableName(fk.reference().foreignTable)),
                localColumns: fk.reference().columns.map((c) => c.name),
                onDelete: (fk.onDelete?.toUpperCase() as ForeignKeyAction) ?? undefined,
                onUpdate: (fk.onUpdate?.toUpperCase() as ForeignKeyAction) ?? undefined,
            })
        }
    }

    return definitions
}

export function getColumnType(column: SQLiteColumn): ColumnType {
    if (column instanceof SQLiteText) {
        return 'TEXT'
    }
    if (column instanceof SQLiteInteger) {
        return 'INTEGER'
    }
    if (column instanceof SQLiteBoolean) {
        return 'INTEGER'
    }
    if (column instanceof SQLiteTextJson) {
        return 'TEXT'
    }
    if (column instanceof SQLiteReal) {
        return 'REAL'
    }
    if (column instanceof SQLiteNumeric) {
        return 'REAL'
    }
    if (column instanceof SQLiteBigInt) {
        return 'INTEGER'
    }
    if (column instanceof SQLiteBlobBuffer) {
        return 'BLOB'
    }
    if (column instanceof SQLiteBlobJson) {
        return 'BLOB'
    }

    throw new Error(`Unsupported column type: ${column.columnType}`)
}

export function getDefaultValue(column: SQLiteColumn): string | null {
    if (column.hasDefault) {
        return transformDefault(column.default) ?? null
    }

    return null
}

export function transformDefault(value: unknown | null | string | number | boolean | SQL | undefined): string {
    if (value === undefined || value === null) {
        return 'NULL'
    }

    if (typeof value === 'string') {
        return escapeString(value)
    }

    if (typeof value === 'number') {
        return value.toString()
    }

    if (typeof value === 'boolean') {
        return value ? '1' : '0'
    }

    if (value instanceof SQL) {
        return value.toQuery({
            escapeString: (s: string) => escapeString(s),
            escapeName: () => {
                throw new Error('Not implemented')
            },
            escapeParam: () => {
                throw new Error('Not implemented')
            },
        }).sql
    }

    return escapeString(JSON.stringify(value))
}

function escapeString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`
}
