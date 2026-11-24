import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import { createMasqueradeService } from '../index.js'
import { accountKitAuthority } from '../account_kit/main.js'
import { MemoryControlStore } from '../testing/main.js'
import { errorCode } from './helpers/core.js'

function fixture(strategy: 'session' | 'access_tokens' = 'session') {
  type User = { id: number }
  const actor: User = { id: 1 }
  const users = new Map<string, User>([
    ['1', actor],
    ['2', { id: 2 }],
  ])
  const store = new MemoryControlStore()
  const revision = new Map([
    ['1', null as string | null],
    ['2', null as string | null],
  ])
  const state = {
    credentialFailure: null as string | null,
    inspectionFailure: undefined as Error | undefined,
    inspectionFailureFor: null as string | null,
    malformedInspectionIdFor: null as string | null,
    denied: new Set<string>(),
    admitted: true,
    inspected: [] as string[],
    currentInputs: [] as { userId: number; revision?: string | null; tokenId?: number }[],
    reads: 0,
  }
  const originalRead = store.read.bind(store)
  store.read = async (owner) => {
    state.reads++
    return originalRead(owner)
  }
  const provider = {
    createUserForGuard: async (user: User) => ({ getId: () => user.id, getOriginal: () => user }),
    findById: async (id: string) => {
      const user = users.get(id)
      if (!user) return null
      return { getId: () => user.id, getOriginal: () => user }
    },
  }
  const kit = () => ({
    authentication: {
      inspectAccountAccess: async ({ userId }: { userId: string; requireActive: true }) => {
        state.inspected.push(userId)
        if (state.inspectionFailure && state.inspectionFailureFor === userId)
          throw state.inspectionFailure
        if (state.denied.has(userId))
          throw Object.assign(new Error('denied'), { code: 'E_ACCOUNT_KIT_ACCOUNT_ACCESS_DENIED' })
        return {
          account: {
            id: state.malformedInspectionIdFor === userId ? Number.NaN : Number(userId),
            active: true,
          },
          revision: revision.get(userId) ?? null,
        }
      },
      current: async (input: { userId: number; revision?: string | null; tokenId?: number }) => {
        state.currentInputs.push(input)
        if (state.credentialFailure)
          throw Object.assign(new Error(state.credentialFailure), {
            code: 'E_ACCOUNT_KIT_INVALID_SESSION',
          })
        return { id: 1 }
      },
    },
  })
  const adapter =
    strategy === 'session'
      ? accountKitAuthority({
          namespace: 'kit',
          incarnation: 'id',
          kit,
          managedGuard: {
            name: 'web',
            strategy: 'session',
            current: async () => ({ userId: 1, revision: revision.get('1') ?? null }),
          },
          provider,
        })
      : accountKitAuthority({
          namespace: 'kit',
          incarnation: 'id',
          kit,
          managedGuard: {
            name: 'api',
            strategy: 'access_tokens',
            current: async () => ({ userId: 1, tokenId: 11 }),
          },
          provider,
          ability: 'masquerade',
        })
  const context = () =>
    ({
      auth: {
        use: () => ({
          driverName: strategy,
          authenticate: async () =>
            strategy === 'session'
              ? actor
              : { ...actor, currentAccessToken: { allows: () => true } },
        }),
      },
    }) as unknown as HttpContext
  const service = createMasqueradeService(
    {
      authority: adapter.authority,
      policy: { canMasquerade: async () => state.admitted },
      store: async () => store,
      retention: 'host-managed',
      contextEnforcement: 'enforce',
    },
    {
      environment: 'test',
      authenticateActor: (ctx: HttpContext) => adapter.authenticateActor(ctx),
      emitter: { emit() {} },
      logger: { info() {}, error() {} },
      observerErrorHandler() {},
      clock: () => new Date('2026-10-22T00:00:00.000Z'),
    }
  )
  const owner = { namespace: 'kit', actorId: '1', actorIncarnation: '1' }
  return { adapter, service, context, state, store, owner, revision }
}

test('Account Kit rejected credentials stop every service operation before a store read', async ({
  assert,
}) => {
  for (const [strategy, reason] of [
    ['session', 'stale revision'],
    ['session', 'ended session handle'],
    ['access_tokens', 'revoked token'],
  ] as const) {
    const f = fixture(strategy)
    const service = await f.service
    f.state.credentialFailure = reason
    const start = () =>
      service.start(f.context(), { targetId: '2', reason: 'support', expectedContext: 'invalid' })
    const stop = () => service.stop(f.context(), { expectedContext: 'invalid' })
    for (const operation of [
      start,
      () => service.status(f.context()),
      () => service.resolve(f.context()),
      stop,
    ])
      assert.equal(await errorCode(operation), 'E_UNAUTHORIZED_ACCESS')
    assert.equal(f.state.reads, 0)
    assert.lengthOf(f.store.events, 0)
  }
})

test('Account Kit actor and target operational inspection errors preserve the complete active mode', async ({
  assert,
}) => {
  for (const accountId of ['1', '2']) {
    for (const failure of ['post_commit', 'database', 'malformed_id'] as const) {
      const f = fixture()
      const service = await f.service
      const idle = await service.status(f.context())
      const active = await service.start(f.context(), {
        targetId: '2',
        reason: 'support',
        expectedContext: idle.contextToken,
      })
      assert.isTrue(active.isMasquerading)
      const originalRow = structuredClone(await f.store.read(f.owner))
      const originalEvents = structuredClone(f.store.events)
      if (failure === 'malformed_id') f.state.malformedInspectionIdFor = accountId
      else {
        f.state.inspectionFailureFor = accountId
        f.state.inspectionFailure =
          failure === 'post_commit'
            ? Object.assign(new Error('post commit'), { code: 'E_ACCOUNT_KIT_POST_COMMIT' })
            : new Error('database unavailable')
      }
      assert.equal(
        await errorCode(() => service.resolve(f.context())),
        failure === 'malformed_id'
          ? 'E_MASQUERADE_ACCOUNT_ID_INVALID'
          : 'E_MASQUERADE_ACCOUNT_INSPECTION_FAILED'
      )
      assert.deepEqual(await f.store.read(f.owner), originalRow)
      assert.deepEqual(f.store.events, originalEvents)
    }
  }
})

test('Account Kit invalid actor credentials preserve the complete active mode', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.service
  const idle = await service.status(f.context())
  await service.start(f.context(), {
    targetId: '2',
    reason: 'support',
    expectedContext: idle.contextToken,
  })
  const originalRow = structuredClone(await f.store.read(f.owner))
  const originalEvents = structuredClone(f.store.events)
  f.state.credentialFailure = 'stale revision'
  assert.equal(await errorCode(() => service.resolve(f.context())), 'E_UNAUTHORIZED_ACCESS')
  assert.deepEqual(await f.store.read(f.owner), originalRow)
  assert.deepEqual(f.store.events, originalEvents)
})

test('Account Kit start inspects target without passing target credentials to current', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.service
  const idle = await service.status(f.context())
  const before = f.state.currentInputs.length
  await service.start(f.context(), {
    targetId: '2',
    reason: 'support',
    expectedContext: idle.contextToken,
  })
  assert.lengthOf(f.state.currentInputs, before + 1)
  assert.deepEqual(
    f.state.currentInputs.map((input) => input.userId),
    [1, 1]
  )
  assert.deepEqual(f.state.inspected.slice(-2), ['1', '2'])
})

test('Account Kit changes invalidate active modes even when provider users are reused', async ({
  assert,
}) => {
  for (const change of [
    'target_stamp',
    'actor_stamp',
    'target_ineligible',
    'policy_denied',
  ] as const) {
    const f = fixture()
    const service = await f.service
    const idle = await service.status(f.context())
    await service.start(f.context(), {
      targetId: '2',
      reason: 'support',
      expectedContext: idle.contextToken,
    })
    const admitted = await service.resolve(f.context())
    assert.equal(admitted.effectiveId, '2')
    if (change === 'target_stamp') f.revision.set('2', '2026-10-22T00:01:00.000Z')
    if (change === 'actor_stamp') f.revision.set('1', '2026-10-22T00:01:00.000Z')
    if (change === 'target_ineligible') f.state.denied.add('2')
    if (change === 'policy_denied') f.state.admitted = false
    assert.equal(
      await errorCode(() => service.resolve(f.context())),
      'E_MASQUERADE_MODE_INVALIDATED'
    )
    assert.equal(f.store.events.at(-1)?.outcomeCode, change)
    const row = await f.store.read(f.owner)
    assert.equal(row?.state, 'idle')
  }
})
