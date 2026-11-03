import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { assertControlStoreConformance } from '../testing/main.js'
import { LucidControlStore } from '../stores/lucid.js'
import { parseRevision } from '../stores/lucid_row.js'
import { sqlFixture, transition } from './helpers/sql_store.js'

test.group('Lucid control store', () => {
  test('exports the complete store conformance on a real database', async () => {
    const f = await sqlFixture()
    try {
      await assertControlStoreConformance(async () => f.store)
    } finally {
      await f.cleanup()
    }
  })
  test('access round-trips on rows and is persisted on events', async ({ assert }) => {
    const f = await sqlFixture()
    try {
      const command = transition()
      command.next = {
        ...command.next,
        state: 'active',
        access: 'edit',
        targetId: 'target',
        targetIncarnation: 'target-v1',
        actorStampHash: 'a'.repeat(64),
        targetStampHash: 'b'.repeat(64),
        reason: 'Ticket 42',
        startedAt: command.event.at,
        expiresAt: '2026-01-01T00:15:00.000Z',
      }
      command.event = {
        ...command.event,
        kind: 'started',
        outcomeCode: 'started',
        access: 'edit',
        targetId: 'target',
        targetIncarnation: 'target-v1',
        reason: 'Ticket 42',
      }
      await f.store.compareAndSet(command)
      const [row] = await f.client.from('masquerade_modes')
      assert.equal(row.access, 'edit')
      const persistedRow = await f.store.read(command.owner)
      assert.equal(persistedRow?.access, 'edit')
      const [event] = await f.client.from('masquerade_events')
      assert.equal(event.access, 'edit')
    } finally {
      await f.cleanup()
    }
  })
  test('independent connections race absent and existing owner with exactly one audit event per winner', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    try {
      const a = transition()
      const b = {
        ...a,
        next: { ...a.next, revisionNonce: 'b'.repeat(32), lastTransitionId: randomUUID() },
        event: { ...a.event, id: randomUUID() },
      }
      b.next.lastTransitionId = b.event.id
      const results = await Promise.all([f.store.compareAndSet(a), f.other.compareAndSet(b)])
      assert.deepEqual(results.map((r) => r.status).sort(), ['applied', 'conflict'])
      const winner = (await f.store.read(a.owner))!
      assert.equal(
        winner.lastTransitionId,
        results[0].status === 'applied' ? a.event.id : b.event.id
      )
      assert.lengthOf(await f.client.from('masquerade_events'), 1)
      const update = {
        ...a,
        expected: 1,
        next: { ...winner, revision: 2, lastTransitionId: randomUUID() },
        event: { ...a.event, revision: 2, id: randomUUID() },
      }
      update.next.lastTransitionId = update.event.id
      const loser = {
        ...update,
        next: { ...update.next, revisionNonce: 'c'.repeat(32), lastTransitionId: randomUUID() },
        event: { ...update.event, id: randomUUID() },
      }
      loser.next.lastTransitionId = loser.event.id
      const updatedResults = await Promise.all([
        f.store.compareAndSet(update),
        f.other.compareAndSet(loser),
      ])
      assert.deepEqual(updatedResults.map((r) => r.status).sort(), ['applied', 'conflict'])
      assert.lengthOf(await f.client.from('masquerade_events'), 2)
    } finally {
      await f.cleanup()
    }
  })
  test('audit payload survives storage and duplicate event failures roll back insert and update', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    try {
      const a = transition()
      a.next = {
        ...a.next,
        state: 'active',
        access: 'view',
        targetId: 'target',
        targetIncarnation: 'target-v1',
        actorStampHash: 'a'.repeat(64),
        targetStampHash: 'b'.repeat(64),
        reason: 'Ticket 42',
        startedAt: a.event.at,
        expiresAt: '2026-01-01T00:15:00.000Z',
      }
      a.event = {
        ...a.event,
        kind: 'started',
        outcomeCode: 'started',
        access: 'view',
        targetId: 'target',
        targetIncarnation: 'target-v1',
        reason: 'Ticket 42',
      }
      await f.store.compareAndSet(a)
      const events = await f.client.from('masquerade_events')
      assert.deepEqual(events[0], {
        id: a.event.id,
        mode_id: a.next.modeId,
        authority_namespace: a.owner.namespace,
        actor_id: a.owner.actorId,
        actor_incarnation: a.owner.actorIncarnation,
        target_id: 'target',
        target_incarnation: 'target-v1',
        at: a.event.at,
        kind: 'started',
        outcome_code: 'started',
        access: 'view',
        revision: f.pg ? '1' : 1,
        reason: 'Ticket 42',
      })
      const other = transition()
      other.event.id = a.event.id
      other.next.lastTransitionId = a.event.id
      await assert.rejects(() => f.other.compareAndSet(other))
      assert.isNull(await f.store.read(other.owner))
      await assert.rejects(() =>
        f.other.compareAndSet({
          ...a,
          expected: 1,
          next: { ...a.next, revision: 2 },
          event: { ...a.event, revision: 2 },
        })
      )
      assert.deepEqual(await f.store.read(a.owner), a.next)
      assert.lengthOf(await f.client.from('masquerade_events'), 1)
      await assert.rejects(() => f.store.recordControlOutcome({ ...a.event, kind: 'control_noop' }))
      assert.deepEqual(await f.store.read(a.owner), a.next)
    } finally {
      await f.cleanup()
    }
  })
  test('retention is bounded, strict before, preserves rows and outcome payload', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    try {
      const a = transition()
      await f.store.compareAndSet(a)
      const outcome = {
        ...a.event,
        id: randomUUID(),
        kind: 'start_denied' as const,
        outcomeCode: 'context_changed',
        at: '2026-01-02T00:00:00.000Z',
      }
      await f.store.recordControlOutcome(outcome)
      assert.equal(await f.store.pruneEvents({ before: outcome.at, limit: 1 }), 1)
      assert.equal(await f.store.pruneEvents({ before: outcome.at, limit: 1 }), 0)
      const [saved] = await f.client.from('masquerade_events')
      assert.equal(saved.id, outcome.id)
      assert.equal(saved.outcome_code, 'context_changed')
      assert.isNull(saved.access)
      assert.equal(saved.reason, null)
      assert.deepEqual(await f.store.read(a.owner), a.next)
    } finally {
      await f.cleanup()
    }
  })
  test('read rejects malformed persisted rows including unsafe BIGINT and noncanonical UTC', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    try {
      const a = transition()
      await f.store.compareAndSet(a)
      for (const change of [
        { revision: '9007199254740992' },
        { revision_nonce: 'invalid' },
        { updated_at: '2026-01-01' },
        { state: 'other' },
        { target_id: 'leak' },
      ]) {
        await f.client.from('masquerade_modes').update(change)
        await assert.rejects(() => f.store.read(a.owner))
        await f.client.from('masquerade_modes').update({
          revision: 1,
          revision_nonce: a.next.revisionNonce,
          updated_at: a.next.updatedAt,
          state: 'idle',
          target_id: null,
        })
      }
      await f.client.from('masquerade_modes').update({ revision: String(Number.MAX_SAFE_INTEGER) })
      assert.equal((await f.store.read(a.owner))!.revision, Number.MAX_SAFE_INTEGER)
    } finally {
      await f.cleanup()
    }
  })
  test('strict BIGINT decoder rejects malformed numeric strings instead of coercing', ({
    assert,
  }) => {
    assert.equal(parseRevision('9007199254740991'), Number.MAX_SAFE_INTEGER)
    for (const value of [
      '1.0',
      '1e2',
      ' 1',
      '+1',
      '01',
      '0',
      '-1',
      '9007199254740992',
      '',
      null,
      1.5,
    ])
      assert.throws(() => parseRevision(value))
  })
  if (process.env.DB_CLIENT !== 'pg')
    test('SQLite bounded busy handling throws without effects and retries safely before commit', async ({
      assert,
    }) => {
      const f = await sqlFixture()
      const lock = await f.client.transaction()
      try {
        await lock.knexQuery().table('masquerade_events').insert({
          authority_namespace: 'lock',
          actor_id: 'a',
          actor_incarnation: 'a',
          id: randomUUID(),
          at: '2026-01-01T00:00:00.000Z',
          kind: 'control_noop',
          outcome_code: 'noop',
          revision: 0,
        })
        const a = transition()
        const bounded = new LucidControlStore(f.second, {
          sqliteBusyRetries: 1,
          sqliteBusyDelayMs: 1,
        })
        const start = Date.now()
        const boundedFailure = await bounded.compareAndSet(a).then(
          () => undefined,
          (error: unknown) => error
        )
        assert.equal((boundedFailure as { code?: string } | undefined)?.code, 'SQLITE_BUSY')
        assert.isBelow(Date.now() - start, 1000)
        assert.isNull(await f.other.read(a.owner))

        let signalBusy!: (observation: { code: string; sql: string }) => void
        const busy = new Promise<{ code: string; sql: string }>((resolve) => {
          signalBusy = resolve
        })
        const busyObservations: Array<{ code: string; sql: string }> = []
        const writeClient = f.second.getWriteClient()
        const onQueryError = (error: { code?: string }, query: { sql: string }) => {
          if (
            error.code === 'SQLITE_BUSY' &&
            /^\s*insert\b/i.test(query.sql) &&
            /\bmasquerade_modes\b/i.test(query.sql)
          ) {
            const observation = { code: error.code, sql: query.sql }
            busyObservations.push(observation)
            signalBusy(observation)
          }
        }
        writeClient.on('query-error', onQueryError)

        let unlockStarted = false
        let deadline: ReturnType<typeof setTimeout> | undefined
        let waiterDeadline: ReturnType<typeof setTimeout> | undefined
        const waiting = new LucidControlStore(f.second, {
          sqliteBusyRetries: 5,
          sqliteBusyDelayMs: 15,
        })
          .compareAndSet(a)
          .then(
            (result) => ({ status: 'settled' as const, result }),
            (error: unknown) => ({ status: 'failed' as const, error })
          )
        try {
          const deadlineReached = new Promise<{ status: 'deadline' }>((resolve) => {
            deadline = setTimeout(() => resolve({ status: 'deadline' }), 1000)
          })
          const beforeBusy = await Promise.race([
            busy.then((observation) => ({ status: 'busy' as const, observation })),
            waiting.then((outcome) => ({ status: 'completed' as const, outcome })),
            deadlineReached,
          ])
          assert.equal(beforeBusy.status, 'busy')
          assert.equal(unlockStarted, false)
          assert.equal(busyObservations.length > 0, true)

          unlockStarted = true
          await lock.rollback()
          const waiterDeadlineReached = new Promise<{ status: 'deadline' }>((resolve) => {
            waiterDeadline = setTimeout(() => resolve({ status: 'deadline' }), 1000)
          })
          const outcome = await Promise.race([waiting, waiterDeadlineReached])
          assert.equal(outcome.status, 'settled')
          if (outcome.status === 'settled')
            assert.deepEqual(outcome.result, { status: 'applied', transitionId: a.event.id })
          assert.deepEqual(await f.store.read(a.owner), a.next)
          const savedEvents = await f.client.from('masquerade_events')
          assert.deepEqual(
            savedEvents.map((event) => event.id),
            [a.event.id]
          )
        } finally {
          if (deadline) clearTimeout(deadline)
          if (waiterDeadline) clearTimeout(waiterDeadline)
          if (!lock.isCompleted) await lock.rollback()
          writeClient.off('query-error', onQueryError)
          // The outcome handlers were attached at launch; wait for all retries to finish before
          // the fixture closes, including when the barrier or its bounded wait fails.
          await waiting
        }
      } finally {
        if (!lock.isCompleted) await lock.rollback()
        await f.cleanup()
      }
    })
  test('lost commit acknowledgement returns indeterminate without retry or compensation', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    try {
      let transactions = 0
      const client = {
        dialect: f.client.dialect,
        isTransaction: false,
        mode: f.client.mode,
        knexQuery: f.client.knexQuery.bind(f.client),
        getWriteClient: () =>
          new Proxy(f.client.getWriteClient(), {
            get(target, property, receiver) {
              if (property !== 'transaction') return Reflect.get(target, property, receiver)
              return async (config: { connection: unknown }) => {
                transactions++
                const tx = await target.transaction(config)
                const commit = tx.commit.bind(tx)
                tx.commit = (async () => {
                  await commit()
                  throw new Error('connection closed before acknowledgement')
                }) as unknown as typeof tx.commit
                return tx
              }
            },
          }),
      }
      const a = transition()
      const store = new LucidControlStore(client as typeof f.client)
      assert.deepEqual(await store.compareAndSet(a), {
        status: 'indeterminate',
        transitionId: a.event.id,
      })
      assert.equal(transactions, 1)
      assert.deepEqual(await f.store.read(a.owner), a.next)
      assert.lengthOf(await f.client.from('masquerade_events'), 1)
    } finally {
      await f.cleanup()
    }
  })

  test('definite commit rejection rolls back; known SQLite busy commit retries the same event once', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    try {
      const a = transition()
      let transactions = 0
      let failureCode = f.pg ? '23514' : 'SQLITE_CONSTRAINT_CHECK'
      const client = {
        dialect: f.client.dialect,
        isTransaction: false,
        mode: f.client.mode,
        knexQuery: f.client.knexQuery.bind(f.client),
        getWriteClient: () =>
          new Proxy(f.client.getWriteClient(), {
            get(target, property, receiver) {
              if (property !== 'transaction') return Reflect.get(target, property, receiver)
              return async (config: { connection: unknown }) => {
                transactions++
                const tx = await target.transaction(config)
                const commit = tx.commit.bind(tx)
                tx.commit = (async () => {
                  if (failureCode) {
                    const code = failureCode
                    failureCode = ''
                    throw Object.assign(new Error('definite rejection'), { code })
                  }
                  await commit()
                }) as unknown as typeof tx.commit
                return tx
              }
            },
          }),
      }
      const store = new LucidControlStore(client as typeof f.client)
      await assert.rejects(() => store.compareAndSet(a))
      assert.equal(transactions, 1)
      assert.isNull(await f.store.read(a.owner))
      assert.lengthOf(await f.client.from('masquerade_events'), 0)
      if (!f.pg) {
        failureCode = 'SQLITE_BUSY'
        assert.deepEqual(await store.compareAndSet(a), {
          status: 'applied',
          transitionId: a.event.id,
        })
        assert.equal(transactions, 3)
        assert.deepEqual(await f.store.read(a.owner), a.next)
        const savedEvents = await f.client.from('masquerade_events')
        assert.deepEqual(
          savedEvents.map((event) => event.id),
          [a.event.id]
        )
      }
    } finally {
      await f.cleanup()
    }
  })
  test('requires a supported nontransaction write client and bounded retry settings', async ({
    assert,
  }) => {
    const f = await sqlFixture()
    try {
      assert.throws(() => new LucidControlStore({ ...f.client, mode: 'read' } as typeof f.client))
      const tx = await f.client.transaction()
      try {
        assert.throws(() => new LucidControlStore(tx))
      } finally {
        await tx.rollback()
      }
      for (const options of [
        { sqliteBusyRetries: -1 },
        { sqliteBusyRetries: 11 },
        { sqliteBusyDelayMs: 1001 },
        { sqliteBusyDelayMs: 0.5 },
      ])
        assert.throws(() => new LucidControlStore(f.client, options))
    } finally {
      await f.cleanup()
    }
  })
})
