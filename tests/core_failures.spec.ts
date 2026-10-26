// Core service failure paths: store reads, CAS and audit writes, observers, loggers, authority
// and policy throws, and races. Happy paths go to core_service.spec.ts, admission to
// core_admission.spec.ts. Fixtures: fixture() and errorCode() in tests/helpers/core.ts.
import { test } from '@japa/runner'
import { fixture, errorCode } from './helpers/core.js'

test('indeterminate committed start logs a safe diagnostic and never emits or records a false denial', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const idle = await service.status({})
  const cas = f.store.compareAndSet.bind(f.store)
  f.store.compareAndSet = async (input) => {
    await cas(input)
    return { status: 'indeterminate', transitionId: input.event.id }
  }
  assert.equal(
    await errorCode(() =>
      service.start(
        {},
        { targetId: 'b', reason: 'private case', expectedContext: idle.contextToken }
      )
    ),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.deepEqual(
    f.store.events.map((event) => event.kind),
    ['started']
  )
  const observedResult1 = await service.status({})
  assert.isTrue(observedResult1.isMasquerading)
  assert.deepEqual(f.diagnostics, [
    {
      category: 'store',
      operation: 'compare_and_set',
      code: 'E_MASQUERADE_UNAVAILABLE',
      transitionId: f.store.events[0].id,
    },
  ])
  assert.notInclude(JSON.stringify(f.diagnostics), 'private case')
})

test('indeterminate committed stop does not emit success or record a false denial', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  f.observed.length = 0
  const cas = f.store.compareAndSet.bind(f.store)
  f.store.compareAndSet = async (input) => {
    await cas(input)
    return { status: 'indeterminate', transitionId: input.event.id }
  }
  assert.equal(
    await errorCode(() => service.stop({}, { expectedContext: active.contextToken })),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.deepEqual(
    f.store.events.map((event) => event.kind),
    ['started', 'stopped']
  )
  const observedResult2 = await service.status({})
  assert.isFalse(observedResult2.isMasquerading)
  assert.deepEqual(f.diagnostics, [
    {
      category: 'store',
      operation: 'compare_and_set',
      code: 'E_MASQUERADE_UNAVAILABLE',
      transitionId: f.store.events[1].id,
    },
  ])
})

test('CAS write and required outcome failures return503 and leave authoritative state unchanged', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const idle = await service.status({})
  f.store.compareAndSet = async () => {
    throw new Error('write failed')
  }
  assert.equal(await errorCode(() => f.start(service)), 'E_MASQUERADE_UNAVAILABLE')
  assert.isNull(await f.store.read(f.owner))
  assert.equal(f.store.events[0].kind, 'start_denied')
  assert.deepEqual(f.diagnostics, [
    { category: 'store', operation: 'compare_and_set', code: 'E_MASQUERADE_UNAVAILABLE' },
    { category: 'control', operation: 'start', code: 'E_MASQUERADE_UNAVAILABLE' },
  ])
  f.diagnostics.length = 0
  f.store.recordControlOutcome = async () => {
    throw new Error('audit failed')
  }
  assert.equal(
    await errorCode(() =>
      service.start({}, { targetId: 'a', reason: 'case', expectedContext: idle.contextToken })
    ),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(
    await errorCode(() => service.stop({}, { expectedContext: idle.contextToken })),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.isNull(await f.store.read(f.owner))
})

test('observer sync throws, rejected promises and rejected reporter cannot alter a committed result', async ({
  assert,
}) => {
  const f = fixture()
  const failure = new Error('listener failed')
  f.dependencies.emitter = {
    emit: () => {
      throw failure
    },
  }
  f.dependencies.logger = {
    info: () => Promise.reject(failure),
    error: (event) => {
      f.diagnostics.push(event)
    },
  }
  f.dependencies.observerErrorHandler = (error) => {
    f.failures.push(error)
    if (f.failures.length === 1) return Promise.reject(new Error('reporter rejected'))
    throw new Error('reporter threw')
  }
  const service = await f.create()
  const observedResult3 = await f.start(service)
  assert.isTrue(observedResult3.isMasquerading)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.failures, [failure, failure])
  assert.deepEqual(f.diagnostics, [
    {
      category: 'observer',
      operation: 'error_reporter',
      code: 'E_MASQUERADE_UNAVAILABLE',
    },
    {
      category: 'observer',
      operation: 'error_reporter',
      code: 'E_MASQUERADE_UNAVAILABLE',
    },
  ])
  assert.notInclude(JSON.stringify(f.diagnostics), failure.message)
  assert.lengthOf(f.store.events, 1)
})

test('never-settling observers are not awaited', async ({ assert }) => {
  const f = fixture()
  f.dependencies.emitter = { emit: () => new Promise(() => {}) }
  f.dependencies.logger = { info: () => new Promise(() => {}), error: () => new Promise(() => {}) }
  const observedResult4 = await f.start(await f.create())
  assert.isTrue(observedResult4.isMasquerading)
})

test('authority and local-policy throws preserve mode without admitting or logging secrets', async ({
  assert,
}) => {
  for (const failure of ['local', 'stamp', 'incarnation'] as const) {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const before = await f.store.read(f.owner)
    if (failure === 'local')
      f.config.policy.canUseRequest = async () => {
        throw new Error('private failure')
      }
    if (failure === 'stamp') f.users.get('a')!.stamp = 's'.repeat(513)
    if (failure === 'incarnation')
      f.config.authority.incarnation = () => {
        throw new Error('private failure')
      }
    const next = await f.create()
    assert.equal(await errorCode(() => next.resolve({})), 'E_MASQUERADE_UNAVAILABLE')
    assert.deepEqual(await f.store.read(f.owner), before)
    assert.lengthOf(f.store.events, 1)
  }
})

test('conflicting expiry cannot clear a newer committed selection', async ({ assert }) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  if (!active.isMasquerading) throw new Error('Expected active')
  f.state.now = Date.parse(active.expiresAt)
  const cas = f.store.compareAndSet.bind(f.store)
  f.store.compareAndSet = async (input) => {
    if (input.event.kind === 'expired') {
      f.store.compareAndSet = cas
      const stop = await service.stop({}, { expectedContext: active.contextToken })
      await service.start(
        {},
        { targetId: 'c', reason: 'new case', expectedContext: stop.contextToken }
      )
    }
    return cas(input)
  }
  const request = {}
  assert.equal(await errorCode(() => service.resolve(request)), 'E_MASQUERADE_CONTEXT_CHANGED')
  assert.equal(await errorCode(() => service.resolve(request)), 'E_MASQUERADE_CONTEXT_CHANGED')
  const observedResult5 = await service.resolve({})
  assert.equal(observedResult5.effectiveId, 'c')
  assert.lengthOf(
    f.store.events.filter((event) => event.kind === 'expired'),
    0
  )
})

test('status and stop fail closed on store read failure without account or policy reads', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  f.store.read = async () => {
    throw new Error('offline')
  }
  assert.equal(await errorCode(() => service.status({})), 'E_MASQUERADE_UNAVAILABLE')
  assert.equal(
    await errorCode(() => service.stop({}, { expectedContext: '0.' + 'a'.repeat(64) })),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(f.state.inspectCount, 0)
  assert.equal(f.state.policyCount, 0)
  assert.deepEqual(f.diagnostics, [
    { category: 'store', operation: 'read', code: 'E_MASQUERADE_UNAVAILABLE' },
    { category: 'store', operation: 'read', code: 'E_MASQUERADE_UNAVAILABLE' },
    { category: 'control', operation: 'stop', code: 'E_MASQUERADE_UNAVAILABLE' },
  ])
})

test('authority and policy failures log safe categories while preserving unavailable responses', async ({
  assert,
}) => {
  const authority = fixture()
  const authorityService = await authority.create()
  await authority.start(authorityService)
  authority.state.inspectThrows = true
  assert.equal(await errorCode(() => authorityService.resolve({})), 'E_MASQUERADE_UNAVAILABLE')
  assert.deepEqual(authority.diagnostics, [
    { category: 'authority', operation: 'inspect_account', code: 'E_MASQUERADE_UNAVAILABLE' },
  ])

  const policy = fixture()
  const policyService = await policy.create()
  await policy.start(policyService)
  policy.state.policyThrows = true
  assert.equal(await errorCode(() => policyService.resolve({})), 'E_MASQUERADE_UNAVAILABLE')
  assert.deepEqual(policy.diagnostics, [
    { category: 'policy', operation: 'can_masquerade', code: 'E_MASQUERADE_UNAVAILABLE' },
  ])

  const requestPolicy = fixture()
  const requestPolicyService = await requestPolicy.create()
  await requestPolicy.start(requestPolicyService)
  requestPolicy.state.localThrows = true
  assert.equal(await errorCode(() => requestPolicyService.resolve({})), 'E_MASQUERADE_UNAVAILABLE')
  assert.deepEqual(requestPolicy.diagnostics, [
    { category: 'policy', operation: 'can_use_request', code: 'E_MASQUERADE_UNAVAILABLE' },
  ])

  const stamp = fixture()
  const stampService = await stamp.create()
  const stampIdle = await stampService.status({})
  stamp.state.stampThrows = true
  assert.equal(
    await errorCode(() =>
      stampService.start(
        {},
        {
          targetId: 'b',
          reason: 'private stamp case',
          expectedContext: stampIdle.contextToken,
        }
      )
    ),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.deepEqual(stamp.diagnostics, [
    { category: 'authority', operation: 'security_stamp', code: 'E_MASQUERADE_UNAVAILABLE' },
    { category: 'control', operation: 'start', code: 'E_MASQUERADE_UNAVAILABLE' },
  ])
  assert.notInclude(JSON.stringify(stamp.diagnostics), 'private stamp case')
})

test('malformed inspection stamps log a bounded authority diagnostic and leave active state intact', async ({
  assert,
}) => {
  for (const account of ['a', 'b']) {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    f.users.get(account)!.stamp = ''

    assert.equal(await errorCode(() => service.resolve({})), 'E_MASQUERADE_UNAVAILABLE')
    assert.deepEqual(f.diagnostics, [
      { category: 'authority', operation: 'security_stamp', code: 'E_MASQUERADE_UNAVAILABLE' },
    ])
    const status = await service.status({})
    assert.isTrue(status.isMasquerading)
    assert.lengthOf(f.store.events, 1)
  }
})

test('actor stamp revocation invalidates before an unrelated malformed target stamp', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  await f.start(service)
  f.users.get('a')!.stamp = 'revoked'
  f.users.get('b')!.stamp = ''

  assert.equal(await errorCode(() => service.resolve({})), 'E_MASQUERADE_CONTEXT_CHANGED')
  const status = await service.status({})
  assert.isFalse(status.isMasquerading)
  assert.deepEqual(
    f.store.events.map((event) => event.kind),
    ['started', 'invalidated']
  )
  assert.deepEqual(f.diagnostics, [])
})

test('denied controls and required audit failures log bounded diagnostics without sensitive data', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const idle = await service.status({})
  f.state.policy = false
  assert.equal(
    await errorCode(() =>
      service.start(
        {},
        {
          targetId: 'b',
          reason: 'private case detail',
          expectedContext: idle.contextToken,
        }
      )
    ),
    'E_MASQUERADE_NOT_ALLOWED'
  )
  assert.deepEqual(f.diagnostics, [
    { category: 'policy', operation: 'can_masquerade', code: 'E_MASQUERADE_NOT_ALLOWED' },
    { category: 'control', operation: 'start', code: 'E_MASQUERADE_NOT_ALLOWED' },
  ])
  assert.notInclude(JSON.stringify(f.diagnostics), 'private case detail')
  assert.notInclude(JSON.stringify(f.diagnostics), 'actorId')
  assert.notInclude(JSON.stringify(f.diagnostics), 'targetId')

  f.diagnostics.length = 0
  const [revision, nonce] = idle.contextToken.split('.')
  const staleContext = `${Number(revision) + 1}.${nonce}`
  assert.equal(
    await errorCode(() => service.stop({}, { expectedContext: staleContext })),
    'E_MASQUERADE_CONTEXT_CHANGED'
  )
  assert.deepEqual(f.diagnostics, [
    { category: 'control', operation: 'stop', code: 'E_MASQUERADE_CONTEXT_CHANGED' },
  ])

  f.diagnostics.length = 0
  f.store.recordControlOutcome = async () => {
    throw new Error('sensitive audit-store details')
  }
  assert.equal(
    await errorCode(() =>
      service.start(
        {},
        { targetId: 'b', reason: 'secret reason', expectedContext: idle.contextToken }
      )
    ),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.deepEqual(f.diagnostics, [
    { category: 'policy', operation: 'can_masquerade', code: 'E_MASQUERADE_NOT_ALLOWED' },
    { category: 'control', operation: 'start', code: 'E_MASQUERADE_NOT_ALLOWED' },
    { category: 'store', operation: 'record_control_outcome', code: 'E_MASQUERADE_UNAVAILABLE' },
  ])
  assert.notInclude(JSON.stringify(f.diagnostics), 'sensitive audit-store details')
  assert.notInclude(JSON.stringify(f.diagnostics), 'secret reason')
})

test('diagnostic logger sync throws and rejected promises cannot change public failures', async ({
  assert,
}) => {
  for (const failure of ['throw', 'reject'] as const) {
    const f = fixture()
    let calls = 0
    f.dependencies.logger.error = () => {
      calls++
      if (failure === 'throw') throw new Error('logger failure')
      return Promise.reject(new Error('logger rejection'))
    }
    const service = await f.create()
    f.store.read = async () => {
      throw new Error('store failure')
    }
    assert.equal(await errorCode(() => service.status({})), 'E_MASQUERADE_UNAVAILABLE')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 1)
  }
})

test('idle stop does not record a denial when its noop outcome acknowledgement fails', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const idle = await service.status({})
  const record = f.store.recordControlOutcome.bind(f.store)
  f.store.recordControlOutcome = async (event) => {
    await record(event)
    throw new Error('outcome acknowledgement lost')
  }

  assert.equal(
    await errorCode(() => service.stop({}, { expectedContext: idle.contextToken })),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.deepEqual(
    f.store.events.map((event) => event.kind),
    ['control_noop']
  )
})

test('simultaneous stop and start with one context cannot replace the active mode', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  const outcomes = await Promise.allSettled([
    service.stop({}, { expectedContext: active.contextToken }),
    service.start({}, { targetId: 'c', reason: 'case', expectedContext: active.contextToken }),
  ])
  assert.equal(outcomes[0].status, 'fulfilled')
  assert.equal(outcomes[1].status, 'rejected')
  assert.equal((await f.store.read(f.owner))!.state, 'idle')
  assert.deepEqual(
    f.store.events.map((event) => event.kind),
    ['started', 'stopped', 'start_denied']
  )
})

test('expired start first clears and rejects stale intent rather than selecting another target', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  if (!active.isMasquerading) throw new Error('Expected active')
  f.state.now = Date.parse(active.expiresAt)
  assert.equal(
    await errorCode(() =>
      service.start({}, { targetId: 'c', reason: 'case', expectedContext: active.contextToken })
    ),
    'E_MASQUERADE_CONTEXT_CHANGED'
  )
  assert.equal((await f.store.read(f.owner))!.state, 'idle')
  assert.deepEqual(
    f.store.events.map((event) => event.kind),
    ['started', 'expired', 'start_denied']
  )
})

for (const missingOutcome of [null, undefined]) {
  for (const operation of ['start', 'stop'] as const) {
    test(`committed ${operation} with ${missingOutcome} outcome is unknown without false denial`, async ({
      assert,
    }) => {
      const f = fixture()
      const service = await f.create()
      const initial = operation === 'stop' ? await f.start(service) : await service.status({})
      f.observed.length = 0
      const cas = f.store.compareAndSet.bind(f.store)
      f.store.compareAndSet = async (input) => {
        await cas(input)
        return missingOutcome as never
      }
      const invoke =
        operation === 'start'
          ? () =>
              service.start(
                {},
                { targetId: 'b', reason: 'private case', expectedContext: initial.contextToken }
              )
          : () => service.stop({}, { expectedContext: initial.contextToken })
      assert.equal(await errorCode(invoke), 'E_MASQUERADE_UNAVAILABLE')
      const last = f.store.events.at(-1)!
      assert.equal(last.kind, operation === 'start' ? 'started' : 'stopped')
      assert.deepEqual(f.diagnostics, [
        {
          category: 'store',
          operation: 'compare_and_set',
          code: 'E_MASQUERADE_UNAVAILABLE',
          transitionId: last.id,
        },
      ])
      assert.lengthOf(f.store.events, operation === 'start' ? 1 : 2)
    })
  }
}

test('failed expired-start denial audit preserves committed expiry and returns503 without compensation', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  if (!active.isMasquerading) throw new Error('Expected active')
  f.state.now = Date.parse(active.expiresAt)
  f.store.recordControlOutcome = async () => {
    throw new Error('audit failed')
  }
  assert.equal(
    await errorCode(() =>
      service.start({}, { targetId: 'c', reason: 'case', expectedContext: active.contextToken })
    ),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal((await f.store.read(f.owner))!.state, 'idle')
  assert.deepEqual(
    f.store.events.map((event) => event.kind),
    ['started', 'expired']
  )
  const fresh = await service.resolve({})
  assert.equal(fresh.effectiveId, 'a')
})
