import { customAlphabet } from 'nanoid'
import { Column, type ForeignKey, type Table } from './definitions'

export function createTableSQL(table: Table, references = true, name: string | null = null) {
    let sql = `CREATE TABLE \`${name ?? table.name}\` (\n`

    const sqlRows: string[] = []

    const columns = Array.from(table.columns.values())

    for (const col of columns) {
        let colSql = `    \`${col.name}\` ${col.type}`

        if (col.notNull) {
            colSql += ' NOT NULL'
        }

        if (col.autoIncrement) {
            colSql += ' AUTO_INCREMENT'
        }

        if (col.defaultValue) {
            colSql += ` DEFAULT ${col.defaultValue}`
        }

        const fk = table.foreignKeys.find((fk) => fk.localColumns.length === 1 && fk.localColumns[0]!.name === col.name)

        if (fk && references) {
            colSql += ` REFERENCES \`${fk.foreignTable.name}\`(\`${fk.foreignColumns[0]!.name}\`) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate
                }`
        }

        sqlRows.push(colSql)
    }

    if (table.primaryKey.length > 0) {
        sqlRows.push(`    PRIMARY KEY (${table.primaryKey.map((c) => `\`${c.name}\``).join(',')})`)
    }

    if (table.foreignKeys.length > 0) {
        for (const fk of table.foreignKeys) {
            if (fk.localColumns.length === 1) {
                continue
            }

            const localStr = fk.localColumns.map((c) => `\`${c.name}\``).join(',')
            const foreignStr = fk.foreignColumns.map((c) => `\`${c.name}\``).join(',')

            sqlRows.push(
                `FOREIGN KEY (${localStr}) REFERENCES \`${fk.foreignTable.name}\`(${foreignStr}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`,
            )
        }
    }

    if (table.uniques.length > 0) {
        for (const unique of table.uniques) {
            sqlRows.push(`    UNIQUE (${unique.columns.map((c) => `\`${c.name}\``).join(',')})`)
        }
    }

    sql += sqlRows.join(',\n')

    sql += '\n)'

    const sqlIndexes: string[] = []

    const result = [sql, ...sqlIndexes]

    return result
}

export function removeTableSQL(tableName: string) {
    return [`DROP TABLE \`${tableName}\``]
}

export function addColumnSQL(column: Column) {
    const tableName = column.ownerTable.name
    return addColumnToTableSQL(tableName, column)
}

export function removeColumnSQL(column: Column) {
    const tableName = column.ownerTable.name

    return [`ALTER TABLE \`${tableName}\` DROP COLUMN \`${column.name}\``]
}

export function copyDataSQL(from: string, to: string, columns: string[]) {
    return [`INSERT INTO \`${to}\` SELECT ${columns.map((c) => `\`${c}\``).join(',')} FROM \`${from}\``]
}

export function recreateTableSql(from: Table, to: Table) {
    const sql: string[] = []

    const newSuffix = `__new__${customAlphabet('1234567890abcdef', 16)()}`

    const newTmpName = `${to.name}${newSuffix}`

    for (const column of to.columns.values()) {
        if (from.columns.has(column.name)) {
            continue
        }

        // Original table doesn't have this column
        // We will add a column to the old table before copying the data
        // And we will set a default value for it on the old table before copying the data
        let tmpDefaultValueForOldTable: string | null = ''

        if (column.type === 'INTEGER' || column.type === 'REAL') {
            tmpDefaultValueForOldTable = '0'
        }

        // In any of these cases, we must add a default value
        const isPk = to.primaryKey.find((c) => c.name === column.name)
        const isUnique = isPk || to.uniques.find((u) => u.columns.find((c) => c.name === column.name) && u.columns.length === 1)

        if (column.defaultValue !== null && column.defaultValue !== 'NULL' && !isUnique) {
            tmpDefaultValueForOldTable = column.defaultValue
        }

        // 2. Add column to old table
        sql.push(
            ...addColumnToTableSQL(
                from.name,
                new Column(column.name, column.type, column.notNull, tmpDefaultValueForOldTable, column.autoIncrement),
            ),
        )

        if (isUnique) {
            // 3. Set default value for the new column
            sql.push(`UPDATE \`${from.name}\` SET \`${column.name}\` = (abs(random()) % 10000000)`)
        }
    }

    // Columns to be copied
    const columns = [...to.columns.values()].map((c) => c.name)

    // 4. Create new table
    sql.push(...createTableSQL(to, false, newTmpName))

    // 5. Copy data from old table to new table
    sql.push(...copyDataSQL(from.name, newTmpName, columns))

    // 6. Drop old table
    sql.push(...removeTableSQL(from.name))

    // 7. Rename new table to old table
    sql.push(`ALTER TABLE \`${newTmpName}\` RENAME TO \`${from.name}\``)

    return sql
}

export function defineColumnSql(column: Column, forceDefault = false) {
    let sql = `\`${column.name}\` ${column.type}`

    let defaultValue: string | null = column.defaultValue

    if (!(defaultValue || defaultValue === 'NULL') && forceDefault) {
        if (column.type === 'INTEGER' || column.type === 'REAL') {
            defaultValue = '0'
        } else {
            defaultValue = '""'
        }
    }

    if (defaultValue === '') {
        defaultValue = '""'
    }

    if (column.notNull) {
        sql += ' NOT NULL'
    }

    if (column.autoIncrement) {
        sql += ' AUTO_INCREMENT'
    }

    if (defaultValue) {
        sql += ` DEFAULT ${defaultValue}`
    }

    return sql
}

export function addColumnToTableSQL(tableName: string, column: Column) {
    if (column.notNull && (column.defaultValue === null || column.defaultValue === undefined || column.defaultValue === 'NULL')) {
        return [
            `ALTER TABLE \`${tableName}\` ADD COLUMN ${defineColumnSql(column, true)}`,
            `ALTER TABLE \`${tableName}\` ALTER COLUMN \`${column.name}\` TO ${defineColumnSql(column, true)}`,
        ]
    }

    return [`ALTER TABLE \`${tableName}\` ADD COLUMN ${defineColumnSql(column)}`]
}

export function addIndexToTableSQL(tableName: string, indexName: string, columns: string[]) {
    return [`CREATE INDEX IF NOT EXISTS \`${indexName}\` ON \`${tableName}\` (${columns.map((c) => `\`${c}\``).join(',')})`]
}

export function removeForeignKeyFromColumnSQL(tableName: string, column: Column) {
    return [`ALTER TABLE \`${tableName}\` ALTER COLUMN \`${column.name}\` TO ${defineColumnSql(column)}`]
}

export function addForeignKeyToColumnSQL(tableName: string, column: Column, fk: ForeignKey) {
    const ref = `REFERENCES \`${fk.foreignTable.name}\`(\`${fk.foreignColumns[0]!.name}\`) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate
        }`

    return [`ALTER TABLE \`${tableName}\` ALTER COLUMN \`${column.name}\` TO ${defineColumnSql(column)} ${ref}`]
}
