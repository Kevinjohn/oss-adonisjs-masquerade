import { test } from '@japa/runner'
import { fixture, errorCode } from './helpers/core.js'

test('exact expiry clears durably without stamp access and rejects the triggering request', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  if (!active.isMasquerading) throw new Error('Expected active view')
  const storedActive = await f.store.read(f.owner)
  if (!storedActive) throw new Error('Expected persisted active row')
  const eventCount = f.store.events.length
  const expiresAt = Date.parse(active.expiresAt)

  f.state.now = Date.parse(active.expiresAt) - 1
  const beforeExpiry = await service.status({})
  if (!beforeExpiry.isMasquerading) throw new Error('Expected persisted active status')
  assert.equal(beforeExpiry.expiresAt, active.expiresAt)
  let stored = await f.store.read(f.owner)
  assert.deepEqual(stored, storedActive)
  assert.lengthOf(f.store.events, eventCount)
  const admittedBeforeExpiry = await service.resolve({})
  assert.equal(admittedBeforeExpiry.effectiveId, 'b')

  for (const now of [expiresAt, expiresAt + 1]) {
    f.state.now = now
    const view = await service.status({})
    if (!view.isMasquerading) throw new Error('Expected persisted active status')
    assert.equal(view.expiresAt, active.expiresAt)
    assert.equal(view.contextToken, active.contextToken)
    stored = await f.store.read(f.owner)
    assert.deepEqual(stored, storedActive)
    assert.lengthOf(f.store.events, eventCount)
  }

  f.state.stampThrows = true
  f.state.inspectThrows = true
  assert.equal(await errorCode(() => service.resolve({})), 'E_MASQUERADE_CONTEXT_CHANGED')
  const expired = await f.store.read(f.owner)
  assert.equal(expired!.state, 'idle')
  assert.equal(expired!.revision, storedActive.revision + 1)
  assert.equal(f.store.events.at(-1)!.kind, 'expired')
  assert.lengthOf(f.store.events, eventCount + 1)
  f.state.now -= 1000000
  const actorAfterExactExpiry = await service.resolve({})
  assert.equal(actorAfterExactExpiry.effectiveId, 'a')
  const statusAfterExactExpiry = await service.status({})
  assert.isFalse(statusAfterExactExpiry.isMasquerading)
})

for (const invalidation of [
  'actor_stamp',
  'target_stamp',
  'actor_ineligible',
  'target_ineligible',
  'policy_denied',
  'edit_denied',
  'target_incarnation',
] as const) {
  test(`global invalidity ${invalidation} clears once and never admits the triggering request`, async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service, {}, invalidation === 'edit_denied' ? 'edit' : undefined)
    if (invalidation === 'actor_stamp') f.users.get('a')!.stamp = 'changed'
    if (invalidation === 'target_stamp') f.users.get('b')!.stamp = 'changed'
    if (invalidation === 'actor_ineligible' || invalidation === 'target_ineligible') {
      const inspect = f.config.authority.inspectAccount
      f.config.authority.inspectAccount = async (id) => {
        const result = await inspect(id)
        if (result && id === (invalidation === 'actor_ineligible' ? 'a' : 'b'))
          result.active = false
        return result
      }
      // The configuration snapshot is immutable; construct a fresh service sharing authoritative state.
    }
    if (invalidation === 'policy_denied') f.state.policy = false
    if (invalidation === 'edit_denied') f.state.edit = false
    if (invalidation === 'target_incarnation') f.users.get('b')!.incarnation = 'new-b'
    const next = await f.create()
    assert.equal(await errorCode(() => next.resolve({})), 'E_MASQUERADE_CONTEXT_CHANGED')
    assert.equal((await f.store.read(f.owner))!.state, 'idle')
    assert.equal(f.store.events.at(-1)!.kind, 'invalidated')
    assert.equal(
      f.store.events.at(-1)!.outcomeCode,
      invalidation === 'target_incarnation' ? 'target_ineligible' : invalidation
    )
    const actorAfterInvalidation = await next.resolve({})
    assert.equal(actorAfterInvalidation.effectiveId, 'a')
  })
}

test('view mode admission never calls canEdit', async ({ assert }) => {
  const f = fixture()
  await f.start(await f.create())
  f.state.editThrows = true
  const service = await f.create()
  assert.equal(await errorCode(() => service.resolve({})), 'NO_ERROR')
  const resolved = await service.resolve({})
  assert.equal(resolved.effectiveId, 'b')
  assert.equal(f.state.editCount, 0)
})

test('edit admission without canEdit invalidates; throwing canEdit preserves mode', async ({
  assert,
}) => {
  for (const failure of ['absent', 'throw'] as const) {
    const f = fixture()
    await f.start(await f.create(), {}, 'edit')
    if (failure === 'absent') delete f.config.policy.canEdit
    else f.state.editThrows = true
    const service = await f.create()
    assert.equal(
      await errorCode(() => service.resolve({})),
      failure === 'absent' ? 'E_MASQUERADE_CONTEXT_CHANGED' : 'E_MASQUERADE_UNAVAILABLE'
    )
    assert.equal((await f.store.read(f.owner))!.state, failure === 'absent' ? 'idle' : 'active')
    if (failure === 'absent') assert.equal(f.store.events.at(-1)!.outcomeCode, 'edit_denied')
  }
})

test('inspection stamp must match the callback stamp captured at start', async ({ assert }) => {
  const f = fixture()
  const service = await f.create()
  await f.start(service)
  const inspect = f.config.authority.inspectAccount
  f.config.authority.inspectAccount = async (id) => {
    const snapshot = await inspect(id)
    if (snapshot && id === 'b') snapshot.securityStamp = 'different-epoch'
    return snapshot
  }

  const next = await f.create()
  assert.equal(await errorCode(() => next.resolve({})), 'E_MASQUERADE_CONTEXT_CHANGED')
  assert.equal((await f.store.read(f.owner))!.state, 'idle')
  assert.equal(f.store.events.at(-1)!.kind, 'invalidated')
  assert.equal(f.store.events.at(-1)!.outcomeCode, 'target_stamp')
})

test('credential and local denial preserve mode; native rejection writes no package event', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  await f.start(service)
  const before = await f.store.read(f.owner)
  for (const operation of [
    () => service.start({ credentialInvalid: true }, {} as never),
    () => service.stop({ credentialInvalid: true }, {} as never),
    () => service.status({ credentialInvalid: true }),
    () => service.resolve({ credentialInvalid: true }),
  ])
    assert.equal(await errorCode(operation), 'native authentication failed')
  assert.equal(await errorCode(() => service.resolve({ denied: true })), 'E_MASQUERADE_NOT_ALLOWED')
  assert.deepEqual(await f.store.read(f.owner), before)
  assert.lengthOf(f.store.events, 1)
})

for (const failure of ['policy', 'inspect', 'read'] as const) {
  test(`${failure} failure rejects admission as unavailable with mode unchanged`, async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const before = await f.store.read(f.owner)
    if (failure === 'policy') f.state.policyThrows = true
    if (failure === 'inspect') f.state.inspectThrows = true
    const read = f.store.read.bind(f.store)
    if (failure === 'read')
      f.store.read = async () => {
        throw new Error('offline')
      }
    assert.equal(await errorCode(() => service.resolve({})), 'E_MASQUERADE_UNAVAILABLE')
    f.store.read = read
    assert.deepEqual(await f.store.read(f.owner), before)
    assert.lengthOf(f.store.events, 1)
  })
}

test('memoizes admission outcomes and freezes safe identity across later mode changes', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  const request = {}
  const first = await service.resolve(request)
  const count = f.state.authenticateCount
  await service.stop({}, { expectedContext: active.contextToken })
  assert.strictEqual(await service.resolve(request), first)
  assert.equal(f.state.authenticateCount, count + 1)
  const actorAfterStop = await service.resolve({})
  assert.equal(actorAfterStop.effectiveId, 'a')
  const denied = { denied: true }
  await f.start(service)
  assert.equal(await errorCode(() => service.resolve(denied)), 'E_MASQUERADE_NOT_ALLOWED')
  denied.denied = false
  assert.equal(await errorCode(() => service.resolve(denied)), 'E_MASQUERADE_NOT_ALLOWED')
  const effectiveUserAfterDeniedAdmission = await service.resolve({})
  assert.equal(effectiveUserAfterDeniedAdmission.effectiveId, 'b')
})

for (const invalidation of ['expiry', 'stamp', 'policy'] as const) {
  test(`repeated admission retains ${invalidation} rejection after durable clearing`, async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    const active = await f.start(service)
    if (!active.isMasquerading) throw new Error('Expected active')
    if (invalidation === 'expiry') f.state.now = Date.parse(active.expiresAt)
    if (invalidation === 'stamp') f.users.get('b')!.stamp = 'changed'
    if (invalidation === 'policy') f.state.policy = false
    const request = {}
    assert.equal(await errorCode(() => service.resolve(request)), 'E_MASQUERADE_CONTEXT_CHANGED')
    const count = f.state.authenticateCount
    assert.equal(await errorCode(() => service.resolve(request)), 'E_MASQUERADE_CONTEXT_CHANGED')
    assert.equal(f.state.authenticateCount, count)
    const fresh = await service.resolve({})
    assert.equal(fresh.effectiveId, 'a')
    assert.equal(
      f.store.events.filter((event) => event.kind === 'expired' || event.kind === 'invalidated')
        .length,
      1
    )
  })
}

test('admission refuses a clock past year 9999 rather than comparing it as text', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  await f.start(service)
  f.state.now = Date.parse('+010000-01-01T00:00:00Z')
  assert.equal(await errorCode(() => service.resolve({})), 'E_MASQUERADE_UNAVAILABLE')
  assert.equal((await f.store.read(f.owner))!.state, 'active')
})
