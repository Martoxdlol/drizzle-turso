import { definitionsFromDrizzleSchema } from './drizzle'

export type ColumnType = 'INTEGER' | 'TEXT' | 'REAL' | 'BLOB' | 'NULL' | ''
export type ForeignKeyAction = 'NO ACTION' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT' | 'CASCADE'

export abstract class TableElement {
    private table: Table | null = null
    mount(table: Table) {
        this.table = table
    }

    public get ownerTable() {
        if (!this.table) {
            throw new Error('TableElement is not mounted')
        }
        return this.table
    }
}

export class Column extends TableElement {
    name: string
    type: ColumnType
    notNull = false
    defaultValue: string | null = null
    autoIncrement = false

    rename(newName: string) {
        this.ownerTable.renameColumn(this.name, newName)
    }

    isUnique() {
        for (const unique of this.ownerTable.uniques) {
            if (unique.columns.length === 1 && unique.columns.includes(this)) {
                return true
            }
        }
    }

    primaryKeyIndex() {
        return this.ownerTable.primaryKey.indexOf(this) + 1
    }

    constructor(name: string, type: ColumnType, notNull = false, defaultValue: string | null = null, autoIncrement = false) {
        super()
        this.name = name
        this.type = type
        this.notNull = notNull
        this.defaultValue = defaultValue === 'NULL' ? null : defaultValue
        this.autoIncrement = autoIncrement
    }

    equals(other: Column) {
        return (
            this.name === other.name &&
            this.type === other.type &&
            this.notNull === other.notNull &&
            this.defaultValue === other.defaultValue
        )
    }
}

export class Index extends TableElement {
    name: string
    unique: boolean
    columns: Column[]

    constructor(name: string, columns: Column[], unique = false) {
        super()
        this.name = name
        this.columns = columns
        this.unique = unique
    }

    verify() {
        for (const column of this.columns) {
            if (column.ownerTable !== this.ownerTable) {
                throw new Error('Index column must belong to the table')
            }
        }
    }

    equals(other: Index) {
        if (this.columns.length !== other.columns.length) {
            return false
        }
        for (let i = 0; i < this.columns.length; i++) {
            if (this.columns[i] !== other.columns[i]) {
                return false
            }
        }
        return true
    }
}

export class Unique extends TableElement {
    columns: Column[]

    constructor(columns: Column[]) {
        super()
        this.columns = columns
    }

    verify() {
        for (const column of this.columns) {
            if (column.ownerTable !== this.ownerTable) {
                throw new Error('Unique column must belong to the table')
            }
        }
        const duplicates = new Set<Column>()
        for (const column of this.columns) {
            if (duplicates.has(column)) {
                throw new Error('Unique columns must be unique')
            }
            duplicates.add(column)
        }
    }

    equals(other: Unique) {
        if (this.columns.length !== other.columns.length) {
            return false
        }
        for (let i = 0; i < this.columns.length; i++) {
            if (this.columns[i] !== other.columns[i]) {
                return false
            }
        }
        return true
    }
}

export class ForeignKey extends TableElement {
    foreignTable: Table
    foreignColumns: Column[]
    localColumns: Column[]
    onUpdate: ForeignKeyAction = 'NO ACTION'
    onDelete: ForeignKeyAction = 'NO ACTION'

    constructor(opts: {
        foreignTable: Table
        foreignColumns: Column[]
        localColumns: Column[]
        onUpdate?: ForeignKeyAction
        onDelete?: ForeignKeyAction
    }) {
        super()
        this.foreignTable = opts.foreignTable
        this.foreignColumns = opts.foreignColumns
        this.localColumns = opts.localColumns
        if (opts.onUpdate) {
            this.onUpdate = opts.onUpdate
        }
        if (opts.onDelete) {
            this.onDelete = opts.onDelete
        }
    }

    addColumnPair(localColumn: Column, foreignColumn: Column) {
        this.localColumns.push(localColumn)
        this.foreignColumns.push(foreignColumn)
    }

    verify() {
        if (this.foreignTable === this.ownerTable) {
            throw new Error('Foreign table must not be the same as the local table')
        }

        if (this.foreignColumns.length === 0) {
            throw new Error('Foreign columns must not be empty')
        }

        if (this.localColumns.length === 0) {
            throw new Error('Local columns must not be empty')
        }

        if (this.foreignColumns.length !== this.localColumns.length) {
            throw new Error('Foreign key columns and local columns must have the same length')
        }

        for (let i = 0; i < this.foreignColumns.length; i++) {
            if (this.foreignColumns[i]!.ownerTable !== this.foreignTable) {
                throw new Error('Foreign key column must belong to the foreign table')
            }
            if (this.localColumns[i]!.ownerTable !== this.ownerTable) {
                throw new Error('Local column must belong to the local table')
            }
        }
        const duplicates = new Set<Column>()
        for (const column of this.localColumns) {
            if (duplicates.has(column)) {
                throw new Error('Local columns must be unique')
            }
            duplicates.add(column)
        }
        duplicates.clear()
        for (const column of this.foreignColumns) {
            if (duplicates.has(column)) {
                throw new Error('Foreign columns must be unique')
            }
            duplicates.add(column)
        }
    }
}

export class Table {
    name: string
    columns: Map<string, Column> = new Map()
    primaryKey: Column[] = []
    foreignKeys: ForeignKey[] = []
    uniques: Unique[] = []
    indexes: Map<string, Index> = new Map()
    definitions: Definitions | null = null

    mount(definitions: Definitions) {
        this.definitions = definitions
    }

    constructor(name: string) {
        this.name = name
    }

    setColumnNameAsPrimaryKey(name: string, index = 1) {
        this.setColumnAsPrimaryKey(this.getColumn(name), index)
    }

    setColumnAsPrimaryKey(column: Column, i = 0) {
        const index = i - 1

        if (index < 0) {
            throw new Error('Index must be greater than 0 (pk_index = 0, means no primary key)')
        }

        if (this.primaryKey[index]) {
            throw new Error('Primary key already set')
        }

        this.primaryKey[index] = column
    }

    createIndex(opts: { name: string; columns: string[]; unique?: boolean }) {
        const index = new Index(
            opts.name,
            opts.columns.map((column) => this.getColumn(column)),
            opts.unique ?? false,
        )
        this.addIndex(index)
        return index
    }

    addIndex(index: Index) {
        index.mount(this)
        this.indexes.set(index.name, index)
    }

    createForeignKey(opts: {
        foreignTable: Table
        foreignColumns: string[]
        localColumns: string[]
        onUpdate?: ForeignKeyAction
        onDelete?: ForeignKeyAction
    }) {
        const foreignColumns = opts.foreignColumns.map((column) => opts.foreignTable.getColumn(column))
        const localColumns = opts.localColumns.map((column) => this.getColumn(column))
        const foreignKey = new ForeignKey({
            foreignTable: opts.foreignTable,
            foreignColumns,
            localColumns,
            onUpdate: opts.onUpdate,
            onDelete: opts.onDelete,
        })
        this.addForeignKey(foreignKey)
        return foreignKey
    }

    addForeignKey(foreignKey: ForeignKey) {
        foreignKey.mount(this)
        foreignKey.verify()
        this.foreignKeys.push(foreignKey)
    }

    createColumn(opts: {
        name: string
        type: ColumnType
        notNull: boolean
        unique: boolean
        defaultValue?: string | null
        autoIncrement?: boolean
    }) {
        const column = new Column(opts.name, opts.type, opts.notNull, opts.defaultValue, opts.autoIncrement)

        if (opts.notNull) {
            column.notNull = true
        }

        this.addColumn(column)

        if (opts.unique) {
            this.createUnique([opts.name])
        }

        return column
    }

    addColumn(column: Column) {
        if (this.columns.has(column.name)) {
            throw new Error(`Duplicate column: ${column.name} on table ${this.name}`)
        }
        column.mount(this)
        this.columns.set(column.name, column)
    }

    getColumn(name: string) {
        const column = this.columns.get(name)
        if (!column) {
            throw new Error(`Column not found: ${name}`)
        }
        return column
    }

    createUnique(columns: string[]) {
        const unique = new Unique(columns.map((column) => this.getColumn(column)))
        for (const existing of this.uniques) {
            if (unique.equals(existing)) {
                throw new Error('Duplicate unique')
            }
        }
        this.addUnique(unique)
        return unique
    }

    addUnique(unique: Unique) {
        unique.mount(this)
        unique.verify()
        this.uniques.push(unique)
    }

    verifyPrimaryKey() {
        for (const column of this.primaryKey) {
            if (!column) {
                throw new Error('Primary key column is undefined')
            }

            if (!this.columns.has(column.name)) {
                throw new Error('Primary key column must belong to the table')
            }
        }
    }

    renameColumn(oldName: string, newName: string) {
        const column = this.getColumn(oldName)
        this.columns.delete(oldName)
        column.name = newName
        this.addColumn(column)
    }

    verify() {
        this.verifyPrimaryKey()
        for (const column of this.columns.values()) {
            if (column.ownerTable !== this) {
                throw new Error('Column must belong to the table')
            }
        }
        for (const index of this.indexes.values()) {
            if (index.ownerTable !== this) {
                throw new Error('Index must belong to the table')
            }
        }
        for (const foreignKey of this.foreignKeys) {
            foreignKey.verify()
        }
        for (const unique of this.uniques) {
            unique.verify()
        }
    }

    toString() {
        let str = `Table (${this.name}) {\n`

        for (const table of this.columns.values()) {
            str += `    ${table.name} ${table.type} ${table.notNull ? 'NOT NULL' : ''} ${table.type} ${table.autoIncrement ? 'AUTOINCREMENT' : ''
                } ${table.defaultValue ? `DEFAULT ${table.defaultValue}` : ''}\n`
        }

        str += `\n    PRIMARY KEY (${this.primaryKey.map((column) => column.name).join(', ')})\n`

        for (const unique of this.uniques) {
            str += `    UNIQUE (${unique.columns.map((column) => column.name).join(', ')})\n`
        }

        if (this.foreignKeys.length > 0) {
            str += '\n'
            for (const foreignKey of this.foreignKeys) {
                str += `    FOREIGN KEY (${foreignKey.localColumns.map((column) => column.name).join(', ')}) REFERENCES ${foreignKey.foreignTable.name
                    } (${foreignKey.foreignColumns.map((column) => column.name).join(', ')}) ON UPDATE ${foreignKey.onUpdate} ON DELETE ${foreignKey.onDelete
                    }\n`
            }
        }

        if (this.indexes.size > 0) {
            str += '\n'
            for (const index of this.indexes.values()) {
                str += `    INDEX ${index.name} (${index.columns.map((column) => column.name).join(', ')})\n`
            }
        }

        str += '}'

        return str
    }
}

export class Definitions {
    tables: Map<string, Table> = new Map()

    referencesToTable(to: Table): Column[] {
        const columns: Column[] = []

        for (const table of this.tables.values()) {
            if (table.name === to.name) {
                continue
            }

            for (const fk of table.foreignKeys) {
                if (fk.foreignTable.name === to.name) {
                    columns.push(...fk.localColumns)
                }
            }
        }
        return columns
    }

    createTable(name: string) {
        const table = new Table(name)
        this.addTable(table)
        return table
    }

    addTable(table: Table) {
        if (this.tables.has(table.name)) {
            throw new Error(`Duplicate table: ${table.name}`)
        }
        table.mount(this)
        this.tables.set(table.name, table)
    }

    getTable(name: string) {
        const table = this.tables.get(name)
        if (!table) {
            throw new Error(`Table not found: ${name}`)
        }
        return table
    }

    toString() {
        let str = ''

        for (const table of this.tables.values()) {
            str += `${table.toString()}\n\n`
        }

        return str.trim()
    }

    static fromDrizzle(schema: Record<string, unknown>) {
        return definitionsFromDrizzleSchema(schema)
    }

    renameTable(oldName: string, newName: string) {
        const table = this.getTable(oldName)
        this.tables.delete(oldName)
        table.name = newName
        this.addTable(table)
    }

    allIndexes() {
        return Array.from(this.tables.values()).flatMap((table) => Array.from(table.indexes.values()))
    }

    allSingleColumnForeignKeys() {
        return Array.from(this.tables.values()).flatMap((table) => table.foreignKeys.filter((fk) => fk.localColumns.length === 1))
    }
}
