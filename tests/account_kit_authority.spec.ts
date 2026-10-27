// The accountKitAuthority adapter alone: credentials, inspection, stamps and options. Service
// outcomes go to account_kit_service.spec.ts, boot checks to account_kit_provider.spec.ts.
// Each test builds inline provider and kit fakes; errorCode() is in tests/helpers/core.ts.
import { test } from '@japa/runner'
import { errors, symbols } from '@adonisjs/auth'
import type { HttpContext } from '@adonisjs/core/http'
import { accountKitAuthority } from '../account_kit/main.js'
import { errorCode } from './helpers/core.js'

test('Account Kit authority captures one inspected revision with the canonical provider user', async ({
  assert,
}) => {
  const user = { id: 'model-id', key: 42, epoch: 'one' }
  let revision: string | null = null
  let inspections = 0
  let inspectedUser = user
  const provider = {
    [symbols.PROVIDER_REAL_USER]: user,
    createUserForGuard: async () => ({ getId: () => 42, getOriginal: () => user }),
    findById: async (id: string) =>
      id === '42' ? { getId: () => 42, getOriginal: () => inspectedUser } : null,
  }
  const kit = {
    authentication: {
      inspectAccountAccess: async (input: { userId: string; requireActive: boolean }) => {
        assert.deepEqual(input, { userId: '42', requireActive: true })
        inspections++
        return { account: { id: 42, active: true }, revision }
      },
      current: async () => ({ id: 42 }),
    },
  }
  const adapter = accountKitAuthority({
    namespace: 'users',
    incarnation: (value: typeof user) => value.epoch,
    kit: async () => kit,
    managedGuard: {
      name: 'web',
      strategy: 'session' as const,
      current: async () => ({ userId: 42, revision }),
    },
    provider,
  })
  const snapshot = await adapter.authority.inspectAccount('42')
  assert.equal(snapshot?.subject.id, '42')
  assert.strictEqual(snapshot?.subject.user, user)
  assert.equal(snapshot?.securityStamp, 'account-kit:null')
  assert.equal(inspections, 1)
  revision = '2026-10-22T00:00:00.000Z'
  inspectedUser = { ...user }
  assert.equal(await adapter.authority.securityStamp(user), 'account-kit:null')
  const revised = await adapter.authority.inspectAccount('42')
  assert.equal(revised?.securityStamp, `account-kit:revision:${revision}`)
  assert.equal(
    await adapter.authority.securityStamp(inspectedUser),
    `account-kit:revision:${revision}`
  )
  assert.equal(
    await errorCode(async () => adapter.authority.securityStamp({ ...user })),
    'E_MASQUERADE_UNAVAILABLE'
  )
})

test('Account Kit authority authenticates through raw guard then current; rejection is native 401', async ({
  assert,
}) => {
  const user = {
    key: 7,
    currentAccessToken: { allows: (ability: string) => ability === 'masquerade' },
  }
  const calls: string[] = []
  let reject = false
  const provider = {
    [symbols.PROVIDER_REAL_USER]: user,
    createUserForGuard: async () => ({ getId: () => 7, getOriginal: () => user }),
    findById: async () => null,
  }
  const adapter = accountKitAuthority({
    namespace: 'users',
    incarnation: 'id',
    kit: async () => ({
      authentication: {
        inspectAccountAccess: async () => ({ account: { id: 7, active: true }, revision: null }),
        current: async () => {
          calls.push('current')
          if (reject)
            throw Object.assign(new Error('Invalid session'), {
              name: 'InvalidSessionError',
              code: 'E_ACCOUNT_KIT_INVALID_SESSION',
            })
          return { id: 7 }
        },
      },
    }),
    managedGuard: {
      name: 'api',
      strategy: 'access_tokens' as const,
      current: async () => {
        calls.push('managed')
        return { userId: 7, tokenId: 1 }
      },
    },
    provider,
    ability: 'masquerade',
  })
  const ctx = {
    auth: {
      use: () => ({
        driverName: 'access_tokens',
        authenticate: async () => {
          calls.push('raw')
          return user
        },
      }),
    },
  } as unknown as HttpContext
  const actor = await adapter.authenticateActor(ctx)
  assert.equal(actor.id, '7')
  assert.deepEqual(calls, ['raw', 'managed', 'current'])
  reject = true
  try {
    await adapter.authenticateActor(ctx)
    assert.fail('expected native unauthorized error')
  } catch (error) {
    assert.instanceOf(error, errors.E_UNAUTHORIZED_ACCESS)
    assert.equal((error as { status: number }).status, 401)
  }
})

test('Account Kit adapter captures ability and raw guard settings at construction', async ({
  assert,
}) => {
  const user = { id: 1, currentAccessToken: { allows: () => false } }
  const managedGuard = {
    name: 'api',
    strategy: 'access_tokens' as const,
    current: async () => ({ userId: 1, tokenId: 1 }),
  }
  const options = {
    namespace: 'users',
    incarnation: 'id' as const,
    ability: 'masquerade',
    managedGuard,
    kit: () => ({
      authentication: {
        inspectAccountAccess: async () => ({ account: { id: 1, active: true }, revision: null }),
        current: async () => ({ id: 1 }),
      },
    }),
    provider: {
      createUserForGuard: async () => ({ getId: () => 1, getOriginal: () => user }),
      findById: async () => null,
    },
  }
  const adapter = accountKitAuthority(options)
  options.ability = ''
  managedGuard.name = 'other'
  ;(managedGuard as { strategy: string }).strategy = 'session'
  assert.equal(adapter.guard, 'api')
  assert.equal(adapter.managedGuard.name, 'api')
  assert.equal(adapter.managedGuard.strategy, 'access_tokens')
  const ctx = {
    auth: {
      use: (name: string) => {
        assert.equal(name, 'api')
        return { driverName: 'access_tokens', authenticate: async () => user }
      },
    },
  } as unknown as HttpContext
  assert.equal(await errorCode(() => adapter.authenticateActor(ctx)), 'E_MASQUERADE_NOT_ALLOWED')
})

test('Account Kit session actor check maps managed rejection to native 401 and operation failure to 503', async ({
  assert,
}) => {
  const user = { id: 1 }
  let failure: Error | undefined
  let rawCalls = 0
  let kitCalls = 0
  const adapter = accountKitAuthority({
    namespace: 'users',
    incarnation: 'id',
    kit: () => ({
      authentication: {
        inspectAccountAccess: async () => ({ account: { id: 1, active: true }, revision: null }),
        current: async () => {
          kitCalls++
          return { id: 1 }
        },
      },
    }),
    managedGuard: {
      name: 'web',
      strategy: 'session',
      current: async () => {
        if (failure) throw failure
        return { userId: 1, revision: null }
      },
    },
    provider: {
      createUserForGuard: async () => ({ getId: () => 1, getOriginal: () => user }),
      findById: async () => null,
    },
  })
  const ctx = {
    auth: {
      use: (name: string) => {
        assert.equal(name, 'web')
        return {
          driverName: 'session',
          authenticate: async () => {
            rawCalls++
            return user
          },
        }
      },
    },
  } as unknown as HttpContext
  const actor = await adapter.authenticateActor(ctx)
  assert.equal(actor.id, '1')
  assert.equal(rawCalls, 1)
  assert.equal(kitCalls, 1)
  failure = Object.assign(new Error('Invalid session'), { code: 'E_ACCOUNT_KIT_INVALID_SESSION' })
  try {
    await adapter.authenticateActor(ctx)
    assert.fail('expected native unauthorized error')
  } catch (error) {
    assert.instanceOf(error, errors.E_UNAUTHORIZED_ACCESS)
    assert.equal((error as { status: number }).status, 401)
    assert.equal((error as { code: string }).code, 'E_UNAUTHORIZED_ACCESS')
    assert.equal((error as { guardDriverName: string }).guardDriverName, 'session')
  }
  assert.equal(kitCalls, 1)
  failure = new Error('db down')
  assert.equal(await errorCode(() => adapter.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
  assert.equal(kitCalls, 1)
})

test('Account Kit denial matching ignores an operational error with the same name', async ({
  assert,
}) => {
  const user = { id: 1 }
  let failInspection = true
  const adapter = accountKitAuthority({
    namespace: 'users',
    incarnation: 'id',
    kit: () => ({
      authentication: {
        inspectAccountAccess: async () => {
          if (failInspection)
            throw Object.assign(new Error('db down'), { name: 'AccountAccessDeniedError' })
          return { account: { id: 1, active: true }, revision: null }
        },
        current: async () => {
          throw Object.assign(new Error('db down'), { name: 'InvalidSessionError' })
        },
      },
    }),
    managedGuard: {
      name: 'web',
      strategy: 'session',
      current: async () => ({ userId: 1, revision: null }),
    },
    provider: {
      createUserForGuard: async () => ({ getId: () => 1, getOriginal: () => user }),
      findById: async () => ({ getId: () => 1, getOriginal: () => user }),
    },
  })
  await assert.rejects(() => adapter.authority.inspectAccount('1'), /db down/)
  failInspection = false
  const ctx = {
    auth: { use: () => ({ driverName: 'session', authenticate: async () => user }) },
  } as unknown as HttpContext
  assert.equal(await errorCode(() => adapter.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
})

test('Account Kit rejects a reused framework user with a changed stamp', async ({ assert }) => {
  const user = { id: 1 }
  let revision: string | null = null
  const adapter = accountKitAuthority({
    namespace: 'users',
    incarnation: 'id',
    kit: () => ({
      authentication: {
        inspectAccountAccess: async () => ({ account: { id: 1, active: true }, revision }),
        current: async () => ({ id: 1 }),
      },
    }),
    managedGuard: {
      name: 'web',
      strategy: 'session',
      current: async () => ({ userId: 1, revision }),
    },
    provider: {
      createUserForGuard: async () => ({ getId: () => 1, getOriginal: () => user }),
      findById: async () => ({ getId: () => 1, getOriginal: () => user }),
    },
  })
  const first = await adapter.authority.inspectAccount('1')
  revision = '2026-10-22T00:00:00.000Z'
  assert.equal(
    await errorCode(() => adapter.authority.inspectAccount('1')),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(first?.securityStamp, 'account-kit:null')
  assert.equal(await adapter.authority.securityStamp(user), 'account-kit:null')
})

test('Account Kit inspection distinguishes denied, missing, mismatched and operational accounts', async ({
  assert,
}) => {
  const user = { key: 7 }
  let inspectedId = 7
  let providerId: unknown = 7
  let missing = false
  let failure: Error | undefined
  const adapter = accountKitAuthority({
    namespace: 'users',
    incarnation: 'id',
    kit: () => ({
      authentication: {
        inspectAccountAccess: async () => {
          if (failure) throw failure
          return { account: { id: inspectedId, active: true }, revision: null }
        },
        current: async () => ({ id: 7 }),
      },
    }),
    managedGuard: {
      name: 'web',
      strategy: 'session',
      current: async () => ({ userId: 7, revision: null }),
    },
    provider: {
      createUserForGuard: async () => ({ getId: () => 7, getOriginal: () => user }),
      findById: async () => (missing ? null : { getId: () => providerId, getOriginal: () => user }),
    },
  })
  failure = Object.assign(new Error('denied'), { code: 'E_ACCOUNT_KIT_ACCOUNT_ACCESS_DENIED' })
  assert.isNull(await adapter.authority.inspectAccount('7'))
  failure = undefined
  missing = true
  assert.isNull(await adapter.authority.inspectAccount('7'))
  missing = false
  providerId = 8
  assert.equal(
    await errorCode(() => adapter.authority.inspectAccount('7')),
    'E_MASQUERADE_UNAVAILABLE'
  )
  providerId = Object(7n)
  assert.equal(
    await errorCode(() => adapter.authority.inspectAccount('7')),
    'E_MASQUERADE_UNAVAILABLE'
  )
  inspectedId = 8
  providerId = 8
  assert.equal(
    await errorCode(() => adapter.authority.inspectAccount('7')),
    'E_MASQUERADE_UNAVAILABLE'
  )
  failure = new Error('db down')
  await assert.rejects(() => adapter.authority.inspectAccount('7'), /db down/)
})

test('Account Kit actor must have the same canonical owner in raw, managed and current results', async ({
  assert,
}) => {
  const user = { id: 7 }
  let managedId = 7
  let kitId = 7
  const adapter = accountKitAuthority({
    namespace: 'users',
    incarnation: 'id',
    kit: () => ({
      authentication: {
        inspectAccountAccess: async () => ({ account: { id: 7, active: true }, revision: null }),
        current: async () => ({ id: kitId }),
      },
    }),
    managedGuard: {
      name: 'web',
      strategy: 'session',
      current: async () => ({ userId: managedId, revision: null }),
    },
    provider: {
      createUserForGuard: async () => ({ getId: () => 7, getOriginal: () => user }),
      findById: async () => null,
    },
  })
  const ctx = {
    auth: { use: () => ({ driverName: 'session', authenticate: async () => user }) },
  } as unknown as HttpContext
  const actor = await adapter.authenticateActor(ctx)
  assert.equal(actor.id, '7')
  kitId = 8
  assert.equal(await errorCode(() => adapter.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
  kitId = 7
  managedId = 8
  assert.equal(await errorCode(() => adapter.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
})

test('Account Kit rejects the wrong raw driver before credential authentication', async ({
  assert,
}) => {
  const user = { id: 7, currentAccessToken: { allows: () => true } }
  let rawAuthentications = 0
  const base = {
    namespace: 'users',
    incarnation: 'id' as const,
    kit: () => ({
      authentication: {
        inspectAccountAccess: async () => ({ account: { id: 7, active: true }, revision: null }),
        current: async () => ({ id: 7 }),
      },
    }),
    provider: {
      createUserForGuard: async () => ({ getId: () => 7, getOriginal: () => user }),
      findById: async () => null,
    },
  }
  const session = accountKitAuthority({
    ...base,
    managedGuard: {
      name: 'web',
      strategy: 'session',
      current: async () => ({ userId: 7, revision: null }),
    },
  })
  const token = accountKitAuthority({
    ...base,
    managedGuard: {
      name: 'api',
      strategy: 'access_tokens',
      current: async () => ({ userId: 7, tokenId: 1 }),
    },
    ability: 'masquerade',
  })
  for (const [adapter, driverName] of [
    [session, 'access_tokens'],
    [token, 'session'],
  ] as const) {
    const ctx = {
      auth: {
        use: () => ({
          driverName,
          authenticate: async () => {
            rawAuthentications++
            return user
          },
        }),
      },
    } as unknown as HttpContext
    assert.equal(await errorCode(() => adapter.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
  }
  assert.equal(rawAuthentications, 0)
})

test('Account Kit authority rejects invalid runtime option families', ({ assert }) => {
  const user = { id: 7 }
  const base = {
    namespace: 'users',
    incarnation: 'id',
    kit: () => ({
      authentication: {
        inspectAccountAccess: async () => ({ account: { id: 7, active: true }, revision: null }),
        current: async () => ({ id: 7 }),
      },
    }),
    provider: {
      createUserForGuard: async () => ({ getId: () => 7, getOriginal: () => user }),
      findById: async () => null,
    },
    managedGuard: {
      name: 'web',
      strategy: 'session',
      current: async () => ({ userId: 7, revision: null }),
    },
  }
  const invalid = [
    { ...base, namespace: '' },
    { ...base, incarnation: 'mutable' },
    { ...base, kit: undefined },
    { ...base, provider: { ...base.provider, findById: undefined } },
    { ...base, managedGuard: { ...base.managedGuard, strategy: 'cookies' } },
    { ...base, ability: 'masquerade' },
    { ...base, managedGuard: { ...base.managedGuard, strategy: 'access_tokens' } },
  ]
  for (const options of invalid)
    assert.throws(() => accountKitAuthority(options as never), TypeError)
})

test('Account Kit token ability denial precedes managed and kit access', async ({ assert }) => {
  const user = { key: 7, currentAccessToken: { allows: () => false } }
  let reads = 0
  const adapter = accountKitAuthority({
    namespace: 'users',
    incarnation: 'id',
    ability: 'masquerade',
    kit: () => {
      reads++
      return {
        authentication: {
          inspectAccountAccess: async () => ({ account: { id: 7, active: true }, revision: null }),
          current: async () => ({ id: 7 }),
        },
      }
    },
    managedGuard: {
      name: 'api',
      strategy: 'access_tokens',
      current: async () => {
        reads++
        return { userId: 7, tokenId: 1 }
      },
    },
    provider: {
      createUserForGuard: async () => {
        reads++
        return { getId: () => 7, getOriginal: () => user }
      },
      findById: async () => null,
    },
  })
  const ctx = {
    auth: { use: () => ({ driverName: 'access_tokens', authenticate: async () => user }) },
  } as unknown as HttpContext
  assert.equal(await errorCode(() => adapter.authenticateActor(ctx)), 'E_MASQUERADE_NOT_ALLOWED')
  assert.equal(reads, 0)
})
