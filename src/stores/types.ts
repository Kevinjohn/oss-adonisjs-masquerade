import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/** The Lucid query client surface the store uses: a connection or a transaction. */
export type LucidControlClient = Pick<
  QueryClientContract,
  'getWriteClient' | 'knexQuery' | 'dialect' | 'isTransaction' | 'mode'
>
/** SQLite busy-lock retry tuning for the Lucid store; PostgreSQL ignores it. */
export interface LucidControlStoreOptions {
  /** Retries after `SQLITE_BUSY` or `SQLITE_LOCKED`; defaults to 3. */
  sqliteBusyRetries?: number
  /** Delay between those retries in milliseconds; defaults to 10. */
  sqliteBusyDelayMs?: number
}
