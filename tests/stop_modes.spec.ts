import { test } from '@japa/runner'
import { createMasqueradeService, defineConfig } from '../index.js'
import { OPERATOR_STOP_OUTCOME, stopActiveModes } from '../src/stop_modes.js'
import { errorCode, fixture } from './helpers/core.js'
import { sqlFixture } from './helpers/sql_store.js'

test.group('operator mode stop', () => {
  test("ends one actor's mode with an audited invalidation and no stamp read", async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    const started = await f.start(service)
    const stampReads = f.state.stampCount
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { actorId: 'a' }), {
      stopped: 1,
    })
    assert.equal(f.state.stampCount, stampReads)
    const row = await f.store.read(f.owner)
    assert.equal(row?.state, 'idle')
    const event = f.store.events.at(-1)!
    assert.include(event, {
      kind: 'invalidated',
      outcomeCode: OPERATOR_STOP_OUTCOME,
      targetId: 'b',
      access: 'view',
      revision: row!.revision,
    })
    assert.equal(event.modeId, row!.modeId)
    assert.include(f.observed.at(-1) as object, { kind: 'invalidated' })
    // The operator's next request is idle and must use the new context.
    const status = await service.status({})
    assert.isFalse(status.isMasquerading)
    assert.notEqual(status.contextToken, started.contextToken)
  })

  test('is a no-op without an event for an idle or unknown-row actor', async ({ assert }) => {
    const f = fixture()
    await f.create()
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { actorId: 'b' }), {
      stopped: 0,
    })
    assert.lengthOf(f.store.events, 0)
  })

  test('records a mode past its deadline as expired and does not count it', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    await f.start(service, { actorId: 'c' })
    f.state.now += 24 * 60 * 60 * 1000
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { actorId: 'a' }), {
      stopped: 0,
    })
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { all: true }), {
      stopped: 0,
    })
    const ended = f.store.events.slice(-2)
    for (const event of ended) assert.include(event, { kind: 'expired', outcomeCode: 'expired' })
    assert.deepEqual(ended.map((event) => event.actorId).sort(), ['a', 'c'])
    const row = await f.store.read(f.owner)
    assert.equal(row?.state, 'idle')
  })

  test('a mode at its exact deadline is recorded as expired', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    const active = await f.start(service)
    if (!active.isMasquerading) throw new Error('Expected active')
    f.state.now = Date.parse(active.expiresAt)
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { actorId: 'a' }), {
      stopped: 0,
    })
    assert.include(f.store.events.at(-1), { kind: 'expired', outcomeCode: 'expired' })
  })

  test('bounds the actor ID before the authority sees it, and refuses a year beyond 9999', async ({
    assert,
  }) => {
    const f = fixture()
    await f.start(await f.create())
    let inspected = 0
    const inspect = f.config.authority.inspectAccount
    f.config.authority.inspectAccount = async (id) => {
      inspected++
      return inspect(id)
    }
    assert.equal(
      await errorCode(() =>
        stopActiveModes(f.config, f.dependencies, { actorId: 'x'.repeat(256) })
      ),
      'E_MASQUERADE_INVALID_INPUT'
    )
    assert.equal(inspected, 0)
    f.state.now = Date.parse('+010000-01-01T00:00:00Z')
    let writes = 0
    const cas = f.store.compareAndSet.bind(f.store)
    f.store.compareAndSet = async (input) => {
      writes++
      return cas(input)
    }
    assert.equal(
      await errorCode(() => stopActiveModes(f.config, f.dependencies, { all: true })),
      'E_MASQUERADE_UNAVAILABLE'
    )
    assert.equal(writes, 0)
  })

  test('resolves the incarnation through the authority or the explicit value', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    f.users.delete('a')
    assert.equal(
      await errorCode(() => stopActiveModes(f.config, f.dependencies, { actorId: 'a' })),
      'E_MASQUERADE_INVALID_INPUT'
    )
    assert.deepEqual(
      await stopActiveModes(f.config, f.dependencies, { actorId: 'a', actorIncarnation: 'other' }),
      { stopped: 0 }
    )
    assert.deepEqual(
      await stopActiveModes(f.config, f.dependencies, { actorId: 'a', actorIncarnation: 'a' }),
      { stopped: 1 }
    )
    const ids = fixture()
    const idConfig = {
      ...ids.config,
      authority: { ...ids.config.authority, incarnation: 'id' as const },
    }
    const idService = await createMasqueradeService(defineConfig(idConfig), ids.dependencies)
    await ids.start(idService)
    const inspected = ids.state.inspectCount
    assert.deepEqual(await stopActiveModes(idConfig, ids.dependencies, { actorId: 'a' }), {
      stopped: 1,
    })
    assert.equal(ids.state.inspectCount, inspected)
  })

  test('retries a conflicting stop and stops the newer mode', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const compareAndSet = f.store.compareAndSet.bind(f.store)
    let raced = false
    f.store.compareAndSet = async (input) => {
      if (!raced && input.event.outcomeCode === OPERATOR_STOP_OUTCOME) {
        raced = true
        const active = await service.status({})
        const idle = await service.stop({}, { expectedContext: active.contextToken })
        await service.start({}, { targetId: 'c', expectedContext: idle.contextToken })
      }
      return compareAndSet(input)
    }
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { actorId: 'a' }), {
      stopped: 1,
    })
    const row = await f.store.read(f.owner)
    assert.equal(row?.state, 'idle')
    const operatorStops = f.store.events.filter((e) => e.outcomeCode === OPERATOR_STOP_OUTCOME)
    assert.lengthOf(operatorStops, 1)
    assert.equal(operatorStops[0].targetId, 'c')
  })

  test('--all ends every active mode across batches', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    await f.start(service, { actorId: 'c' })
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { all: true, batchSize: 1 }), {
      stopped: 2,
    })
    assert.deepEqual(await f.store.activeBatch({ limit: 10 }), [])
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { all: true }), {
      stopped: 0,
    })
    for (const batchSize of [0, 1001])
      assert.equal(
        await errorCode(() => stopActiveModes(f.config, f.dependencies, { all: true, batchSize })),
        'E_MASQUERADE_UNAVAILABLE'
      )
  })

  test('--all stops when a batch only conflicts', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    f.store.compareAndSet = async () => ({ status: 'conflict' })
    assert.deepEqual(await stopActiveModes(f.config, f.dependencies, { all: true }), {
      stopped: 0,
    })
  })

  test('concurrent stops on two SQL connections yield one winner and one event', async ({
    assert,
  }) => {
    const sql = await sqlFixture()
    try {
      const f = fixture()
      const config = { ...f.config, store: async () => sql.store }
      const otherConfig = { ...f.config, store: async () => sql.other }
      const service = await createMasqueradeService(defineConfig(config), f.dependencies)
      await f.start(service)
      const results = await Promise.all([
        stopActiveModes(config, f.dependencies, { actorId: 'a' }),
        stopActiveModes(otherConfig, f.dependencies, { actorId: 'a' }),
      ])
      assert.sameMembers(
        results.map((result) => result.stopped),
        [0, 1]
      )
      const row = await sql.store.read(f.owner)
      assert.equal(row?.state, 'idle')
      const events = await sql.client
        .knexQuery()
        .from('masquerade_events')
        .where('outcome_code', OPERATOR_STOP_OUTCOME)
      assert.lengthOf(events, 1)
    } finally {
      await sql.cleanup()
    }
  })
})
