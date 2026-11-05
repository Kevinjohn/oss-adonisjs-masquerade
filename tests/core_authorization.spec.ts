import { test } from '@japa/runner'
import { fixture, errorCode } from './helpers/core.js'

test('invalid access values are 422 with start_denied and no revision change', async ({
  assert,
}) => {
  for (const access of [null, '', 'VIEW', 1, [], {}]) {
    const f = fixture()
    const service = await f.create()
    const idle = await service.status({})
    assert.equal(
      await errorCode(() =>
        service.start({}, {
          targetId: 'b',
          reason: 'case',
          expectedContext: idle.contextToken,
          access,
        } as never)
      ),
      'E_MASQUERADE_INVALID_INPUT'
    )
    assert.isNull(await f.store.read(f.owner))
    assert.equal(f.store.events[0].kind, 'start_denied')
    assert.notProperty(f.store.events[0], 'access')
  }
})

test('invalid access keeps context and already-active precedence', async ({ assert }) => {
  const f = fixture()
  const service = await f.create()
  const idle = await service.status({})
  const input = { targetId: 'b', reason: 'case', access: null }
  const active = await f.start(service)
  assert.equal(
    await errorCode(() =>
      service.start({}, { ...input, expectedContext: idle.contextToken } as never)
    ),
    'E_MASQUERADE_CONTEXT_CHANGED'
  )
  assert.equal(
    await errorCode(() =>
      service.start({}, { ...input, expectedContext: active.contextToken } as never)
    ),
    'E_MASQUERADE_ALREADY_ACTIVE'
  )
  assert.equal((await f.store.read(f.owner))!.revision, 1)
  assert.notEqual(active.contextToken, idle.contextToken)
})

test('edit start requires canEdit literal true; absent, false, non-boolean and throw do not start', async ({
  assert,
}) => {
  for (const value of ['absent', false, 1, 'true', 'throw'] as const) {
    const f = fixture()
    if (value === 'absent') delete f.config.policy.canEdit
    else if (value === 'throw') f.state.editThrows = true
    else f.state.edit = value
    const service = await f.create()
    assert.equal(
      await errorCode(() => f.start(service, {}, 'edit')),
      value === 'throw' ? 'E_MASQUERADE_UNAVAILABLE' : 'E_MASQUERADE_NOT_ALLOWED'
    )
    assert.isNull(await f.store.read(f.owner))
    assert.equal(f.store.events[0].kind, 'start_denied')
    if (value === 'throw')
      assert.isTrue(
        f.diagnostics.some((item) => (item as { operation?: string }).operation === 'can_edit')
      )
  }
})

test('view start never calls canEdit', async ({ assert }) => {
  const f = fixture()
  f.state.editThrows = true
  const service = await f.create()
  assert.equal(await errorCode(() => f.start(service)), 'NO_ERROR')
  assert.equal(f.state.editCount, 0)
})

test('edit policy receives start reason and request but no admission request', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const startRequest = { actorId: 'a' }
  await f.start(service, startRequest, 'edit')
  assert.equal(f.state.editCount, 1)
  assert.strictEqual((f.state.editInputs[0] as { request?: object }).request, startRequest)
  assert.equal((f.state.editInputs[0] as { reason?: string }).reason, 'support\ncase\t42')
  await service.resolve({})
  assert.equal(f.state.editCount, 2)
  assert.notProperty(f.state.editInputs[1] as object, 'request')
  assert.notProperty(f.state.editInputs[1] as object, 'reason')
})

test('edit policy follows global policy and precedes request policy on start and admission', async ({
  assert,
}) => {
  const f = fixture()
  const timeline: string[] = []
  let globalAllowed = true
  f.config.policy.canMasquerade = async (input) => {
    timeline.push('global')
    assert.equal(input.actor.id, 'a')
    assert.equal(input.target.id, 'b')
    return globalAllowed
  }
  f.config.policy.canEdit = async (input) => {
    timeline.push('edit')
    assert.equal(input.actor.id, 'a')
    assert.equal(input.target.id, 'b')
    return true
  }
  f.config.policy.canUseRequest = async () => {
    timeline.push('request')
    return true
  }
  const service = await f.create()
  await f.start(service, {}, 'edit')
  assert.deepEqual(timeline, ['global', 'edit', 'request'])
  timeline.length = 0
  await service.resolve({})
  assert.deepEqual(timeline, ['global', 'edit', 'request'])

  timeline.length = 0
  globalAllowed = false
  const deniedAdmission = await f.create()
  assert.equal(await errorCode(() => deniedAdmission.resolve({})), 'E_MASQUERADE_CONTEXT_CHANGED')
  assert.deepEqual(timeline, ['global'])
  assert.equal(f.store.events.at(-1)!.outcomeCode, 'policy_denied')

  const deniedStart = fixture()
  const startCalls: string[] = []
  deniedStart.config.policy.canMasquerade = async () => {
    startCalls.push('global')
    return false
  }
  deniedStart.config.policy.canEdit = async () => {
    startCalls.push('edit')
    return true
  }
  deniedStart.config.policy.canUseRequest = async () => {
    startCalls.push('request')
    return true
  }
  const deniedStartService = await deniedStart.create()
  assert.equal(
    await errorCode(() => deniedStart.start(deniedStartService, {}, 'edit')),
    'E_MASQUERADE_NOT_ALLOWED'
  )
  assert.deepEqual(startCalls, ['global'])
})

test('start preserves input-shape, context and active-mode error precedence', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const idle = await service.status({})
  const selection = { targetId: 'b', reason: '', durationSeconds: 0 }
  assert.equal(
    await errorCode(() => service.start({}, { ...selection, expectedContext: '' })),
    'E_MASQUERADE_CONTEXT_REQUIRED'
  )
  assert.equal(
    await errorCode(() =>
      service.start({}, { ...selection, expectedContext: '', extra: true } as never)
    ),
    'E_MASQUERADE_INVALID_INPUT'
  )
  const active = await f.start(service)
  assert.equal(
    await errorCode(() => service.start({}, { ...selection, expectedContext: idle.contextToken })),
    'E_MASQUERADE_CONTEXT_CHANGED'
  )
  assert.equal(
    await errorCode(() =>
      service.start({}, { ...selection, expectedContext: active.contextToken })
    ),
    'E_MASQUERADE_ALREADY_ACTIVE'
  )
  assert.deepEqual(
    f.store.events.map((event) => event.kind),
    ['start_denied', 'start_denied', 'started', 'start_denied', 'start_denied']
  )
  const row = await f.store.read(f.owner)
  assert.equal(row?.revision, 1)
})

test('start denies false and truthy nonboolean policy; policy throws unavailable; no revision change', async ({
  assert,
}) => {
  for (const value of [false, 1, undefined, 'true', 'throw']) {
    const f = fixture()
    f.config.policy.canMasquerade = async () => {
      if (value === 'throw') throw new Error('policy')
      return value as boolean
    }
    const service = await f.create()
    assert.equal(
      await errorCode(() => f.start(service)),
      value === 'throw' ? 'E_MASQUERADE_UNAVAILABLE' : 'E_MASQUERADE_NOT_ALLOWED'
    )
    assert.isNull(await f.store.read(f.owner))
    assert.equal(f.store.events[0].kind, 'start_denied')
    assert.notProperty(f.store.events[0], 'reason')
  }
})

test('self-targeting, missing and ineligible targets are denied without target enumeration', async ({
  assert,
}) => {
  for (const kind of ['self', 'missing', 'ineligible']) {
    const f = fixture()
    if (kind === 'missing') f.users.delete('b')
    if (kind === 'ineligible') {
      const inspect = f.config.authority.inspectAccount
      f.config.authority.inspectAccount = async (id) => {
        const result = await inspect(id)
        if (id === 'b' && result) result.active = false
        return result
      }
    }
    const service = await f.create()
    const idle = await service.status({})
    assert.equal(
      await errorCode(() =>
        service.start(
          {},
          {
            targetId: kind === 'self' ? 'a' : 'b',
            reason: 'case',
            expectedContext: idle.contextToken,
          }
        )
      ),
      kind === 'self' ? 'E_MASQUERADE_INVALID_INPUT' : 'E_MASQUERADE_NOT_ALLOWED'
    )
    assert.isNull(await f.store.read(f.owner))
    // A parsed request records the requested target and access, never an inspected incarnation;
    // self-targeting is invalid input and records neither.
    if (kind === 'self') assert.notProperty(f.store.events[0], 'targetId')
    else {
      assert.equal(f.store.events[0].targetId, 'b')
      assert.equal(f.store.events[0].access, 'view')
    }
    assert.notProperty(f.store.events[0], 'targetIncarnation')
  }
})

test('incarnation and namespace isolate rows and no-row contexts; client actor substitution rejected', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  f.config.authority.namespace = 'other'
  const other = await f.create()
  const statusInOtherNamespace = await other.status({})
  assert.isFalse(statusInOtherNamespace.isMasquerading)
  assert.equal(
    await errorCode(() => other.stop({}, { expectedContext: active.contextToken })),
    'E_MASQUERADE_CONTEXT_CHANGED'
  )
  f.config.authority.namespace = 'test'
  f.users.get('a')!.incarnation = 'new-a'
  const replacement = await f.create()
  const idle = await replacement.status({})
  assert.isFalse(idle.isMasquerading)
  assert.equal(
    await errorCode(() => replacement.stop({}, { expectedContext: active.contextToken })),
    'E_MASQUERADE_CONTEXT_CHANGED'
  )
  assert.equal(
    await errorCode(() =>
      replacement.start({}, {
        targetId: 'b',
        reason: 'case',
        expectedContext: idle.contextToken,
        actorId: 'c',
      } as never)
    ),
    'E_MASQUERADE_INVALID_INPUT'
  )
  assert.equal((await f.store.read(f.owner))!.state, 'active')
})

test('start policy receives reason/request and admission policy gets neither; local tenant denial preserves revision', async ({
  assert,
}) => {
  const f = fixture()
  const calls: unknown[] = []
  f.config.policy.canMasquerade = async (input) => {
    calls.push(input)
    return true
  }
  const service = await f.create()
  const active = await f.start(service)
  assert.equal(await errorCode(() => service.resolve({ denied: true })), 'E_MASQUERADE_NOT_ALLOWED')
  const inputs = calls as { reason?: string; request?: unknown }[]
  assert.equal(inputs[0].reason, 'support\ncase\t42')
  assert.property(inputs[0], 'request')
  assert.notProperty(inputs[1], 'reason')
  assert.notProperty(inputs[1], 'request')
  const statusAfterDeniedRequest = await service.status({})
  assert.equal(statusAfterDeniedRequest.contextToken, active.contextToken)
  const effectiveUserAfterAdmission = await service.resolve({})
  assert.equal(effectiveUserAfterAdmission.effectiveId, 'b')
})

test('duration boundaries, host narrowing and invalid input audit do not leak rejected reason', async ({
  assert,
}) => {
  const f = fixture()
  f.config.durationSeconds = 60
  f.config.maxDurationSeconds = 120
  const service = await f.create()
  for (const durationSeconds of [59, 121, Number.NaN, Infinity, 60.5]) {
    const idle = await service.status({})
    assert.equal(
      await errorCode(() =>
        service.start(
          {},
          {
            targetId: 'b',
            reason: 'private case',
            durationSeconds,
            expectedContext: idle.contextToken,
          }
        )
      ),
      'E_MASQUERADE_INVALID_INPUT'
    )
    assert.notProperty(f.store.events.at(-1)!, 'reason')
  }
  const active = await f.start(service)
  if (!active.isMasquerading) throw new Error('Expected active')
  assert.equal(Date.parse(active.expiresAt) - Date.parse(active.startedAt), 60000)
})

test('concurrent admission of one request authenticates and reads authoritative state once', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  await f.start(service)
  let reads = 0
  const read = f.store.read.bind(f.store)
  f.store.read = async (owner) => {
    reads++
    return read(owner)
  }
  const count = f.state.authenticateCount
  const request = {}
  const contexts = await Promise.all([
    service.resolve(request),
    service.resolve(request),
    service.resolve(request),
  ])
  assert.strictEqual(contexts[0], contexts[1])
  assert.strictEqual(contexts[0], contexts[2])
  assert.equal(reads, 1)
  assert.equal(f.state.authenticateCount, count + 1)
})

test('canonical provider self-target is invalid input without core ID coercion', async ({
  assert,
}) => {
  const f = fixture()
  const inspect = f.config.authority.inspectAccount
  f.config.authority.inspectAccount = (id) => inspect(id === 'alias' ? 'a' : id)
  const service = await f.create()
  const idle = await service.status({})
  assert.equal(
    await errorCode(() =>
      service.start({}, { targetId: 'alias', reason: 'case', expectedContext: idle.contextToken })
    ),
    'E_MASQUERADE_INVALID_INPUT'
  )
})

test('accepts canonical numeric/string/UUID identifiers without merging distinct spellings', async ({
  assert,
}) => {
  for (const targetId of [1, '001', '6a3c8137-3b2a-43a3-8124-c9b0ebc15a43']) {
    const f = fixture()
    const id = String(targetId)
    f.users.set(id, { id, incarnation: id, stamp: 'opaque', privateData: 'private-model' })
    const service = await f.create()
    const idle = await service.status({})
    const active = await service.start(
      {},
      { targetId, reason: 'case', durationSeconds: 3600, expectedContext: idle.contextToken }
    )
    assert.propertyVal(active, 'targetId', id)
    assert.equal((await f.store.read(f.owner))!.targetId, id)
  }
})

test('actor and target deletion invalidate an admitted native actor without target fallback', async ({
  assert,
}) => {
  for (const id of ['a', 'b']) {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const actor = f.users.get('a')!
    f.dependencies.authenticateActor = async () => ({
      id: actor.id,
      incarnation: actor.incarnation,
      user: actor,
    })
    f.users.delete(id)
    const next = await f.create()
    assert.equal(await errorCode(() => next.resolve({})), 'E_MASQUERADE_CONTEXT_CHANGED')
    assert.equal((await f.store.read(f.owner))!.state, 'idle')
    assert.equal(
      f.store.events.at(-1)!.outcomeCode,
      id === 'a' ? 'actor_ineligible' : 'target_ineligible'
    )
  }
})

test('explicit null start duration is rejected and audited instead of defaulted', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const idle = await service.status({})
  assert.equal(
    await errorCode(() =>
      service.start({}, {
        targetId: 'b',
        reason: 'case',
        expectedContext: idle.contextToken,
        durationSeconds: null,
      } as never)
    ),
    'E_MASQUERADE_INVALID_INPUT'
  )
  assert.isNull(await f.store.read(f.owner))
  assert.equal(f.store.events[0].kind, 'start_denied')
})
