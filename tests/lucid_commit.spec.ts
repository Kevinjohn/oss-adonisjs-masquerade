import { test } from '@japa/runner'
import { LucidControlStore } from '../stores/lucid.js'
import { sqlFixture, transition } from './helpers/sql_store.js'

if (process.env.DB_CLIENT === 'pg') {
  test('a real PostgreSQL deferred constraint rejects COMMIT and never reports applied', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    try {
      await f.client.schema.createTable('permitted_events', (table) =>
        table.string('id', 36).primary()
      )
      await f.client.rawQuery(
        'ALTER TABLE masquerade_events ADD CONSTRAINT permitted_event FOREIGN KEY (id) REFERENCES permitted_events(id) DEFERRABLE INITIALLY DEFERRED'
      )
      const a = transition()
      await assert.rejects(() => f.store.compareAndSet(a))
      assert.isNull(await f.other.read(a.owner))
      assert.lengthOf(await f.second.from('masquerade_events'), 0)
      await f.client.rawQuery('ALTER TABLE masquerade_events DROP CONSTRAINT permitted_event')
      assert.deepEqual(await f.store.compareAndSet(a), {
        status: 'applied',
        transitionId: a.event.id,
      })
      assert.deepEqual(await f.other.read(a.owner), a.next)
    } finally {
      await f.client
        .rawQuery('ALTER TABLE masquerade_events DROP CONSTRAINT IF EXISTS permitted_event')
        .catch(() => {})
      await f.client.schema.dropTableIfExists('permitted_events').catch(() => {})
      await f.cleanup()
    }
  })
  test('a PostgreSQL backend lost mid-transaction retires its connection, not the store or pool', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    const blocker = await f.client.transaction()
    try {
      await blocker.rawQuery('LOCK TABLE masquerade_modes IN ACCESS EXCLUSIVE MODE')
      const a = transition()
      const pending = f.other.compareAndSet(a)
      pending.catch(() => {})
      // Wait for the CAS backend to queue behind the lock, then terminate it mid-transaction.
      let pids: number[] = []
      for (let attempt = 0; attempt < 100 && pids.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        const waiting = await blocker.rawQuery(
          'select pid from pg_locks where not granted and pid <> pg_backend_pid()'
        )
        pids = waiting.rows.map((row: { pid: number }) => row.pid)
      }
      assert.isNotEmpty(pids)
      for (const pid of pids) await blocker.rawQuery('select pg_terminate_backend(?)', [pid])
      await assert.rejects(() => pending)
      await blocker.rollback()
      assert.isNull(await f.other.read(a.owner))
      assert.deepEqual(await f.other.compareAndSet(a), {
        status: 'applied',
        transitionId: a.event.id,
      })
      assert.deepEqual(await f.store.read(a.owner), a.next)
    } finally {
      if (!blocker.isCompleted) await blocker.rollback()
      await f.cleanup()
    }
  }).timeout(10_000)
} else {
  test('a real SQLite reader lock rejects writer COMMIT and cleans native transaction before reuse', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    const reader = await f.client.transaction()
    try {
      await reader.from('masquerade_modes')
      const a = transition()
      const store = new LucidControlStore(f.second, { sqliteBusyRetries: 0 })
      await assert.rejects(() => store.compareAndSet(a))
      assert.lengthOf(await reader.from('masquerade_modes'), 0)
      assert.lengthOf(await reader.from('masquerade_events'), 0)
      await reader.rollback()
      assert.deepEqual(await store.compareAndSet(a), {
        status: 'applied',
        transitionId: a.event.id,
      })
      assert.deepEqual(await f.store.read(a.owner), a.next)
      assert.lengthOf(await f.client.from('masquerade_events'), 1)
    } finally {
      if (!reader.isCompleted) await reader.rollback()
      // Ensure an intentionally broken adapter cannot leave the fixture locked.
      await Promise.resolve()
        .then(() => f.second.rawQuery('ROLLBACK'))
        .catch(() => {})
      await f.cleanup()
    }
  })
  test('SQLite failed cleanup retires the shared pool before a dirty connection can be reused', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    const reader = await f.client.transaction()
    let shutdown: Promise<void> | undefined
    try {
      await reader.from('masquerade_modes')
      const knex = f.second.getWriteClient()
      const pinned = new Proxy(knex, {
        get(target, property, receiver) {
          if (property === 'raw')
            return (sql: string) => {
              if (sql === 'ROLLBACK') throw new Error('native rollback connection failure')
              return target.raw(sql)
            }
          if (property === 'destroy')
            return () => {
              shutdown = target.destroy()
              return shutdown
            }
          return Reflect.get(target, property, receiver)
        },
      })
      const store = new LucidControlStore(
        {
          dialect: f.second.dialect,
          mode: f.second.mode,
          isTransaction: false,
          knexQuery: f.second.knexQuery.bind(f.second),
          getWriteClient: () => pinned,
        },
        { sqliteBusyRetries: 0 }
      )
      const a = transition()
      await assert.rejects(() => store.compareAndSet(a), 'native rollback connection failure')
      await reader.rollback()
      if (shutdown) await shutdown
      await assert.rejects(() => store.read(a.owner), 'Masquerade is unavailable')
      await assert.rejects(() => f.second.from('masquerade_modes'))
      assert.isNull(await f.store.read(a.owner))
      assert.lengthOf(await f.client.from('masquerade_events'), 0)
    } finally {
      if (!reader.isCompleted) await reader.rollback()
      if (shutdown) await shutdown
      await Promise.resolve()
        .then(() => f.second.rawQuery('ROLLBACK'))
        .catch(() => {})
      await f.cleanup()
    }
  })
  test('a real SQLite busy COMMIT safely retries after native rollback with the same transition ID', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    const reader = await f.client.transaction()
    let unlock: Promise<unknown> | undefined
    const busyCodes: string[] = []
    f.second
      .getWriteClient()
      .on('query-error', (error: { code?: string }, query: { sql: string }) => {
        if (/^COMMIT/i.test(query.sql)) {
          busyCodes.push(error.code ?? '')
          unlock = reader.rollback().then(
            () => undefined,
            (failure: unknown) => failure
          )
        }
      })
    try {
      await reader.from('masquerade_modes')
      const a = transition()
      const store = new LucidControlStore(f.second, { sqliteBusyRetries: 2, sqliteBusyDelayMs: 10 })
      assert.deepEqual(await store.compareAndSet(a), {
        status: 'applied',
        transitionId: a.event.id,
      })
      assert.isUndefined(await unlock)
      assert.deepEqual(busyCodes, ['SQLITE_BUSY'])
      assert.deepEqual(await f.store.read(a.owner), a.next)
      const events = await f.client.from('masquerade_events')
      assert.deepEqual(
        events.map((event) => event.id),
        [a.event.id]
      )
    } finally {
      if (!reader.isCompleted) await reader.rollback()
      await Promise.resolve()
        .then(() => f.second.rawQuery('ROLLBACK'))
        .catch(() => {})
      await f.cleanup()
    }
  })
}

test('rejects externally managed Knex pools before persistence', async ({ assert }) => {
  const f = await sqlFixture()
  try {
    const knex = f.client.getWriteClient()
    const external = new Proxy(knex, {
      get(target, property, receiver) {
        if (property === 'client')
          return new Proxy(target.client, {
            get(client, key, clientReceiver) {
              if (key === 'config') return { ...client.config, connectionPool: {} }
              return Reflect.get(client, key, clientReceiver)
            },
          })
        return Reflect.get(target, property, receiver)
      },
    })
    assert.throws(
      () =>
        new LucidControlStore({
          dialect: f.client.dialect,
          mode: f.client.mode,
          isTransaction: false,
          knexQuery: f.client.knexQuery.bind(f.client),
          getWriteClient: () => external,
        }),
      'Masquerade is unavailable'
    )
    assert.lengthOf(await f.client.from('masquerade_modes'), 0)
  } finally {
    await f.cleanup()
  }
})

if (process.env.DB_CLIENT !== 'pg') {
  test('cleanup quarantine returns while another checkout awaits the failed CAS', async ({
    assert,
  }) => {
    const f = await sqlFixture({ poolMax: 2 })
    const reader = await f.client.transaction()
    const knex = f.second.getWriteClient()
    const unrelated = await knex.client.acquireConnection()
    const writer = await knex.client.acquireConnection()
    await knex.raw('PRAGMA busy_timeout = 5').connection(writer)
    await knex.client.releaseConnection(writer)
    let shutdown: Promise<void> | undefined
    let operation: Promise<unknown> | undefined
    const retired = new Proxy(knex, {
      get(target, property, receiver) {
        if (property === 'raw')
          return (sql: string) => {
            if (sql === 'ROLLBACK') throw new Error('native rollback connection failure')
            return target.raw(sql)
          }
        if (property === 'destroy')
          return () => {
            shutdown = target.destroy()
            return shutdown
          }
        return Reflect.get(target, property, receiver)
      },
    })
    try {
      await reader.from('masquerade_modes')
      const store = new LucidControlStore(
        {
          dialect: f.second.dialect,
          mode: f.second.mode,
          isTransaction: false,
          knexQuery: f.second.knexQuery.bind(f.second),
          getWriteClient: () => retired,
        },
        { sqliteBusyRetries: 0 }
      )
      operation = store.compareAndSet(transition()).then(
        () => 'applied',
        (error: unknown) => error
      )
      const result = await Promise.race([
        operation,
        new Promise((resolve) => setTimeout(() => resolve('blocked'), 1000)),
      ])
      assert.instanceOf(result, Error)
      assert.equal((result as Error).message, 'native rollback connection failure')
      const nextCheckout = knex.client.acquireConnection().then(
        async (connection: unknown) => {
          await knex.client.releaseConnection(connection)
          return 'acquired'
        },
        () => 'rejected'
      )
      assert.equal(
        await Promise.race([
          nextCheckout,
          new Promise((resolve) => setTimeout(() => resolve('blocked'), 10)),
        ]),
        'blocked'
      )
      let drained = false
      shutdown!.then(
        () => {
          drained = true
        },
        () => {
          drained = true
        }
      )
      await Promise.resolve()
      assert.isFalse(drained)
    } finally {
      await knex.client.releaseConnection(unrelated)
      if (shutdown) await shutdown
      if (operation) await operation
      if (!reader.isCompleted) await reader.rollback()
      await f.cleanup()
    }
  })
}
