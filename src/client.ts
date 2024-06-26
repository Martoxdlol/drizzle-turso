import type { Client } from '@libsql/client'
export type MinimalClient = Pick<Client, 'execute' | 'executeMultiple' | 'batch'>
