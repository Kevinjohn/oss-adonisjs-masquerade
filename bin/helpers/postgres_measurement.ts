import type { Client as PgClient } from 'pg'

type PostgresMeasurementClient = Pick<PgClient, 'connect' | 'query' | 'end'>

export type PostgresMeasurementTransaction = {
  begin(): Promise<void>
  commit(): Promise<void>
}

/** Runs one benchmark against a temporary schema and attempts every owned cleanup step. */
export async function withPostgresMeasurement<T>(
  client: PostgresMeasurementClient,
  schema: string,
  measure: (transaction: PostgresMeasurementTransaction) => Promise<T>
): Promise<T> {
  let transactionOpen = false
  let primaryFailure: unknown
  let hasPrimaryFailure = false
  let result: T

  try {
    await client.connect()
    result = await measure({
      async begin() {
        await client.query('BEGIN')
        transactionOpen = true
      },
      async commit() {
        await client.query('COMMIT')
        transactionOpen = false
      },
    })
  } catch (error) {
    hasPrimaryFailure = true
    primaryFailure = error
  }

  const cleanupFailures: unknown[] = []
  if (transactionOpen) {
    try {
      await client.query('ROLLBACK')
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    await client.end()
  } catch (error) {
    cleanupFailures.push(error)
  }

  if (hasPrimaryFailure || cleanupFailures.length > 0) {
    const errors = hasPrimaryFailure ? [primaryFailure, ...cleanupFailures] : cleanupFailures
    throw new AggregateError(errors, 'PostgreSQL measurement or cleanup failed.')
  }
  return result!
}
