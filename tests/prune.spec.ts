import { test } from '@japa/runner'
import { pruneMasquerade } from '../src/prune.js'
import { createMasqueradeService } from '../src/service.js'
import { MasqueradeSetupError } from '../src/errors.js'
import { fixture, errorCode } from './helpers/core.js'

test("prune expiry event carries the row's access", async ({ assert }) => {
  const f = fixture()
  await f.start(await f.create(), {}, 'edit')
  const commit = f.store.compareAndSet.bind(f.store)
  let producedAccess: string | undefined
  f.store.compareAndSet = async (input) => {
    producedAccess = input.event.access
    input.event.access = 'edit'
    return commit(input)
  }
  f.state.now += 901_000
  assert.equal(
    await errorCode(() => pruneMasquerade(f.config, f.dependencies, { batchSize: 1 })),
    'NO_ERROR'
  )
  assert.equal(producedAccess, 'edit')
  assert.equal(f.store.events.at(-1)!.access, 'edit')
})

test.group('pruneMasquerade', () => {
  test('preserves a missing resolved store as a setup error', async ({ assert }) => {
    const f = fixture()
    const error = await pruneMasquerade(
      { ...f.config, store: async () => null as never },
      f.dependencies
    ).catch((caught: unknown) => caught)
    assert.instanceOf(error, MasqueradeSetupError)
    assert.equal((error as MasqueradeSetupError).code, 'E_MASQUERADE_INVALID_STORE')
    assert.equal((error as MasqueradeSetupError).field, 'store')
  })

  test('preserves a missing store capability as a setup error', async ({ assert }) => {
    const f = fixture()
    f.store.expiredBatch = undefined as never
    const error = await pruneMasquerade(f.config, f.dependencies).catch((caught: unknown) => caught)
    assert.instanceOf(error, MasqueradeSetupError)
    assert.equal((error as MasqueradeSetupError).code, 'E_MASQUERADE_INVALID_STORE')
    assert.equal((error as MasqueradeSetupError).field, 'store.expiredBatch')
  })

  test('normalizes a throwing store factory as operational unavailability', async ({ assert }) => {
    const f = fixture()
    const error = await pruneMasquerade(
      {
        ...f.config,
        store: async () => {
          throw new Error('store connection failed')
        },
      },
      f.dependencies
    ).catch((caught: unknown) => caught)
    assert.notInstanceOf(error, MasqueradeSetupError)
    assert.equal((error as { code: string }).code, 'E_MASQUERADE_UNAVAILABLE')
  })

  test('expires a still-current expired row and preserves the active audit projection', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    f.state.now += 901_000
    const result = await pruneMasquerade(f.config, f.dependencies, { batchSize: 1 })
    const row = await f.store.read(f.owner)
    assert.deepEqual(result, { expired: 1, eventsDeleted: 0 })
    assert.equal(row?.state, 'idle')
    assert.equal(row?.revision, 2)
    const expired = f.observed.find((event) => (event as { kind?: string }).kind === 'expired') as
      Record<string, unknown> | undefined
    assert.equal(expired?.targetId, 'b')
    assert.equal(expired?.targetIncarnation, 'b')
    assert.equal(expired?.outcomeCode, 'expired')
    assert.notProperty(expired ?? {}, 'reason')
    assert.notProperty(expired ?? {}, 'actorStampHash')
  })

  test('expires mixed namespaces by owner incarnation and retains idle rows', async ({
    assert,
  }) => {
    const f = fixture()
    const defaultService = await f.create()
    await f.start(defaultService)

    f.users.get('c')!.incarnation = 'actor-c-v2'
    f.users.get('b')!.incarnation = 'target-b-v2'
    const otherConfig = {
      ...f.config,
      authority: { ...f.config.authority, namespace: 'other' },
    }
    const otherService = await createMasqueradeService(otherConfig, f.dependencies)
    const otherIdleContext = await otherService.status({ actorId: 'c' })
    await otherService.start(
      { actorId: 'c' },
      {
        targetId: 'b',
        reason: 'other namespace mode',
        expectedContext: otherIdleContext.contextToken,
      }
    )
    const idleOwnerContext = await otherService.status({ actorId: 'a' })
    await otherService.start(
      { actorId: 'a' },
      {
        targetId: 'c',
        reason: 'mode to retain idle row',
        expectedContext: idleOwnerContext.contextToken,
      }
    )
    const idleMode = await otherService.status({ actorId: 'a' })
    await otherService.stop({ actorId: 'a' }, { expectedContext: idleMode.contextToken })

    f.state.now += 901_000
    const result = await pruneMasquerade(f.config, f.dependencies)

    assert.equal(result.expired, 2)
    const defaultRow = await f.store.read(f.owner)
    assert.equal(defaultRow?.state, 'idle')
    const otherOwner = {
      namespace: 'other',
      actorId: 'c',
      actorIncarnation: 'actor-c-v2',
    }
    const otherRow = await f.store.read(otherOwner)
    assert.equal(otherRow?.state, 'idle')
    const retainedIdleOwner = {
      namespace: 'other',
      actorId: 'a',
      actorIncarnation: 'a',
    }
    const retainedIdleRow = await f.store.read(retainedIdleOwner)
    assert.equal(retainedIdleRow?.state, 'idle')
    const expiredEvents = f.observed.filter(
      (event) => (event as { kind?: string }).kind === 'expired'
    ) as Array<Record<string, unknown>>
    const distinctExpiredEvents = [
      ...new Map(expiredEvents.map((event) => [event.id, event])).values(),
    ]
    assert.deepEqual(
      distinctExpiredEvents.map(
        ({ namespace, actorId, actorIncarnation, targetId, targetIncarnation }) => ({
          namespace,
          actorId,
          actorIncarnation,
          targetId,
          targetIncarnation,
        })
      ),
      [
        {
          namespace: 'test',
          actorId: 'a',
          actorIncarnation: 'a',
          targetId: 'b',
          targetIncarnation: 'b',
        },
        {
          namespace: 'other',
          actorId: 'c',
          actorIncarnation: 'actor-c-v2',
          targetId: 'b',
          targetIncarnation: 'target-b-v2',
        },
      ]
    )
  })

  test('does not clear a newer revision after an expired batch snapshot', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    f.state.now += 901_000
    const expiredBatch = f.store.expiredBatch.bind(f.store)
    let raced = false
    f.store.expiredBatch = async (input) => {
      const candidates = await expiredBatch(input)
      if (!raced && candidates.length) {
        raced = true
        const expireService = await f.create()
        const active = await expireService.status({})
        await expireService.stop({}, { expectedContext: active.contextToken })
        const idle = await expireService.status({})
        const restart = await f.create()
        await restart.start(
          {},
          { targetId: 'c', reason: 'new mode', expectedContext: idle.contextToken }
        )
      }
      return candidates
    }
    const result = await pruneMasquerade(f.config, f.dependencies)
    assert.equal(result.expired, 0)
    const winner = await f.store.read(f.owner)
    assert.equal(winner?.state, 'active')
    assert.equal(winner?.revision, 3)
    assert.equal(winner?.targetId, 'c')
  })

  test('does not prune events when retention is host-managed and never prunes idle rows', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    const active = await f.start(service)
    await service.stop({}, { expectedContext: active.contextToken })
    const idle = await f.store.read(f.owner)
    assert.equal(idle?.state, 'idle')
    f.state.now += 400 * 86_400_000
    const pruneEvents = f.store.pruneEvents.bind(f.store)
    let called = false
    f.store.pruneEvents = async (input) => {
      called = true
      return pruneEvents(input)
    }
    const result = await pruneMasquerade(f.config, f.dependencies)
    assert.deepEqual(result, { expired: 0, eventsDeleted: 0 })
    assert.isFalse(called)
    assert.deepEqual(await f.store.read(f.owner), idle)
    assert.lengthOf(f.store.events, 2)
  })

  test('deletes only a bounded batch of events older than the configured retention window', async ({
    assert,
  }) => {
    const f = fixture()
    f.config.retention = { days: 1 }
    const service = await f.create()
    await service.status({})
    f.state.now += 2 * 86_400_000
    let cutoff = ''
    f.store.pruneEvents = async ({ before, limit }) => {
      cutoff = before
      return limit
    }
    const result = await pruneMasquerade(f.config, f.dependencies, { batchSize: 1 })
    assert.deepEqual(result, { expired: 0, eventsDeleted: 1 })
    assert.equal(cutoff, '2026-01-02T00:00:00.000Z')
  })

  test('rejects invalid batch size and invalid clock values', async ({ assert }) => {
    const f = fixture()
    await assert.rejects(() => pruneMasquerade(f.config, f.dependencies, { batchSize: 0 }))
    await assert.rejects(() =>
      pruneMasquerade(f.config, { ...f.dependencies, clock: () => new Date(Number.NaN) })
    )
  })

  test('a CAS conflict skips expiry without emitting a transition', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const before = await f.store.read(f.owner)
    f.observed.length = 0
    f.state.now += 901_000
    f.store.compareAndSet = async () => ({ status: 'conflict' })
    assert.deepEqual(await pruneMasquerade(f.config, f.dependencies), {
      expired: 0,
      eventsDeleted: 0,
    })
    assert.deepEqual(await f.store.read(f.owner), before)
    assert.lengthOf(f.store.events, 1)
    assert.deepEqual(f.observed, [])
  })

  test('an uncertain expiry commit reports a safe diagnostic without emitting success or compensating', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    f.state.now += 901_000
    f.observed.length = 0
    const compareAndSet = f.store.compareAndSet.bind(f.store)
    f.store.compareAndSet = async (input) => {
      await compareAndSet(input)
      return { status: 'indeterminate', transitionId: input.event.id }
    }
    assert.equal(
      await errorCode(() => pruneMasquerade(f.config, f.dependencies)),
      'E_MASQUERADE_UNAVAILABLE'
    )
    const row = await f.store.read(f.owner)
    assert.equal(row?.state, 'idle')
    assert.deepEqual(
      f.store.events.map((event) => event.kind),
      ['started', 'expired']
    )
    assert.deepEqual(f.diagnostics, [
      {
        category: 'store',
        operation: 'compare_and_set',
        code: 'E_MASQUERADE_UNAVAILABLE',
        transitionId: f.store.events[1].id,
      },
    ])
  })

  test('a row that blocks expiry does not block event retention', async ({ assert }) => {
    const f = fixture()
    f.config.retention = { days: 1 }
    const service = await f.create()
    await f.start(service)
    f.state.now += 2 * 86_400_000
    f.store.expiredBatch = async () => {
      throw new Error('malformed row')
    }
    assert.equal(
      await errorCode(() => pruneMasquerade(f.config, f.dependencies)),
      'E_MASQUERADE_UNAVAILABLE'
    )
    assert.lengthOf(f.store.events, 0)
  })

  test('refuses a clock beyond year 9999, where instants no longer compare as text', async ({
    assert,
  }) => {
    const f = fixture()
    await f.create()
    assert.equal(
      await errorCode(() =>
        pruneMasquerade(f.config, f.dependencies, { now: new Date('+010000-01-01T00:00:00Z') })
      ),
      'E_MASQUERADE_UNAVAILABLE'
    )
  })

  test('revision exhaustion rejects expiry without changing its row or audit', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    f.state.now += 901_000
    const read = f.store.read.bind(f.store)
    const exhausted = { ...(await read(f.owner))!, revision: Number.MAX_SAFE_INTEGER }
    f.store.read = async () => exhausted
    f.store.expiredBatch = async () => [exhausted]
    f.observed.length = 0
    assert.equal(
      await errorCode(() => pruneMasquerade(f.config, f.dependencies)),
      'E_MASQUERADE_UNAVAILABLE'
    )
    const row = await read(f.owner)
    assert.equal(row?.revision, 1)
    assert.lengthOf(f.store.events, 1)
    assert.deepEqual(f.observed, [])
  })
})
