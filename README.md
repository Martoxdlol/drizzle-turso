# drizzle-turso

Push `drizzle-orm` defined schema to a libsql [Turso](https://turso.tech) database.

It can also fetch the remote db schema to a usable format and the same for local drizzle definition.

**Warning**: I'm currently using this package on production but **I cannot assure you that it will not break your data**.
Please be careful when you use it and always do backups before doing changes that can result in data loss.

**Disclaimer**: If you use this library, I'm not responsible of any possible data loss or problem you find using it.
Anyway, if you find some bug or anything feel free to create a issue.

**Contribution**: I'm open to contributions.

## Limitations

It is currently not supporting autoincrement but it shouldn't be that hard to fix.

The code is not that great but it is being very useful or a large projects with 60+ tables, and a lot of relations.

## Push schema to remote db

```ts
import { createClient } from '@libsql/client/web'
import { pushDrizzleSchema, getRemoteDefinitions, definitionsFromDrizzleSchema, Table, differences } from 'drizzle-turso'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// It doesn't have to be Turso, but I've only really tested it with turso.
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
```

## Other functions

```ts
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
```

## Get sql operations from differences of schemas

```ts
const result = differences(remoteDefinitions, localDefinitions)

console.log(result.operations)
console.log(result.summary)
```