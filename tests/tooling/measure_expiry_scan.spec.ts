import assert from 'node:assert/strict'
import { test } from '@japa/runner'
import { withPostgresMeasurement } from '../../bin/helpers/postgres_measurement.js'

const schema = 'expiry_measurement_fixture'
const drop = `DROP SCHEMA IF EXISTS ${schema} CASCADE`

function fakeClient(failures = new Map<string, Error>()) {
  const calls: string[] = []
  const client = {
    async connect() {
      calls.push('connect')
    },
    async query(sql: string) {
      calls.push(sql)
      const failure = failures.get(sql)
      if (failure) throw failure
      return { rows: [], rowCount: 0 }
    },
    async end() {
      calls.push('end')
      const failure = failures.get('end')
      if (failure) throw failure
    },
  }
  return {
    client: client as unknown as Parameters<typeof withPostgresMeasurement>[0],
    calls,
  }
}

function assertFailures(error: unknown, expected: unknown[]): void {
  assert.ok(error instanceof AggregateError)
  assert.deepEqual(error.errors, expected)
}

test('preserves a successful measurement when client close fails', async () => {
  const closeFailure = new Error('close failed')
  const { client, calls } = fakeClient(new Map([['end', closeFailure]]))

  await assert.rejects(
    withPostgresMeasurement(client, schema, async ({ begin, commit }) => {
      await begin()
      await commit()
      return 'measured'
    }),
    (error: unknown) => {
      assertFailures(error, [closeFailure])
      return true
    }
  )
  assert.deepEqual(calls, ['connect', 'BEGIN', 'COMMIT', drop, 'end'])
})

test('preserves an operation failure and attempts drop and close after rollback fails', async () => {
  const operationFailure = new Error('operation failed')
  const rollbackFailure = new Error('rollback failed')
  const { client, calls } = fakeClient(new Map([['ROLLBACK', rollbackFailure]]))

  await assert.rejects(
    withPostgresMeasurement(client, schema, async ({ begin }) => {
      await begin()
      throw operationFailure
    }),
    (error: unknown) => {
      assertFailures(error, [operationFailure, rollbackFailure])
      return true
    }
  )
  assert.deepEqual(calls, ['connect', 'BEGIN', 'ROLLBACK', drop, 'end'])
})

test('preserves an operation failure and closes the client after schema drop fails', async () => {
  const operationFailure = new Error('operation failed')
  const dropFailure = new Error('schema drop failed')
  const { client, calls } = fakeClient(new Map([[drop, dropFailure]]))

  await assert.rejects(
    withPostgresMeasurement(client, schema, async () => {
      throw operationFailure
    }),
    (error: unknown) => {
      assertFailures(error, [operationFailure, dropFailure])
      return true
    }
  )
  assert.deepEqual(calls, ['connect', drop, 'end'])
})

test('preserves the operation and every rollback, drop, and close failure in cleanup order', async () => {
  const operationFailure = new Error('operation failed')
  const rollbackFailure = new Error('rollback failed')
  const dropFailure = new Error('schema drop failed')
  const closeFailure = new Error('close failed')
  const { client, calls } = fakeClient(
    new Map([
      ['ROLLBACK', rollbackFailure],
      [drop, dropFailure],
      ['end', closeFailure],
    ])
  )

  await assert.rejects(
    withPostgresMeasurement(client, schema, async ({ begin }) => {
      await begin()
      throw operationFailure
    }),
    (error: unknown) => {
      assertFailures(error, [operationFailure, rollbackFailure, dropFailure, closeFailure])
      return true
    }
  )
  assert.deepEqual(calls, ['connect', 'BEGIN', 'ROLLBACK', drop, 'end'])
})
