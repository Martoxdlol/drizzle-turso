import { createClient } from '@libsql/client/web'
import { pushDrizzleSchema, getRemoteDefinitions, definitionsFromDrizzleSchema, Table, differences } from '../src'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// It doen't have to be turso, but I've only really tested it with turso.
const client = createClient({
    url: 'https://my-db-my-username.turso.io',
    authToken: 'my-auth-token'
})

const users = sqliteTable('app_users', {
    id: text('id').primaryKey(),
    name: text('name'),
    email: text('email'),
})

const posts = sqliteTable('app_posts', {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id),
    title: text('title'),
    content: text('content'),
})

const schema = {
    users,
    posts
}

// It will update remote schema to match the local schema. 
// Similar to `prisma db push` or `drizzle-kit push` but it won't prompt you anything and it will resolve some other cases that drizzle can't.
await pushDrizzleSchema(client, schema, {
    log: (...args) => console.log("Push schema log:", ...args), // Optional, it is console.log by default
    prefix: 'app_' // Optional, it is '' by default. Useful if you want to ignore tables that do not start with that prefix
})

/// Other functions:

const localDefinitions = definitionsFromDrizzleSchema(schema)

console.log(localDefinitions.tables)

console.log(localDefinitions.getTable('user').columns)

localDefinitions.addTable(new Table('app_new_table'))

localDefinitions.getTable('app_new_table').createColumn({
    name: 'id',
    notNull: true,
    type: 'TEXT',
    unique: true,
})

// (... and more ...)


const remoteDefinitions = await getRemoteDefinitions(client, { prefix: 'app_' })

console.log(remoteDefinitions.allIndexes())

/// Get individual operations

const result = differences(remoteDefinitions, localDefinitions)

console.log(result.operations)
console.log(result.summary)