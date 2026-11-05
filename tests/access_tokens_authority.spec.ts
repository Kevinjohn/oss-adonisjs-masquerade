import { errors, symbols } from '@adonisjs/auth'
import { test } from '@japa/runner'
import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
import type { HttpContext } from '@adonisjs/core/http'
import { accessTokensAuthority } from '../native/main.js'
import { errorCode } from './helpers/core.js'

test('access token authority authenticates its named guard, enforces ability, and maps canonical identity', async ({
  assert,
}) => {
  const user = { id: 'model-id', key: 42n, incarnation: 'account-v1', stamp: 'private' }
  let guardName = ''
  let ability = ''
  let providerLookups = 0
  const provider: AccessTokensUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async (model) => ({ getId: () => model.key, getOriginal: () => model }),
    findById: async (id) => {
      providerLookups++
      return id === '42' ? { getId: () => user.key, getOriginal: () => user } : null
    },
    createToken: async () => ({}) as never,
    invalidateToken: async () => true,
    verifyToken: async () => null,
  }
  const native = accessTokensAuthority({
    namespace: 'users',
    guard: 'api',
    provider,
    ability: 'masquerade',
    incarnation: (model) => model.incarnation,
    securityStamp: (model) => model.stamp,
    isActive: () => true,
  })
  const tokenUser = Object.assign(user, {
    currentAccessToken: {
      allows(value: string) {
        ability = value
        return true
      },
    },
  })
  const ctx = {
    auth: {
      use(name: string) {
        guardName = name
        return { driverName: 'access_tokens', authenticate: async () => tokenUser }
      },
    },
  } as unknown as HttpContext

  const actor = await native.authenticateActor(ctx)
  assert.equal(guardName, 'api')
  assert.equal(ability, 'masquerade')
  assert.equal(actor.id, '42')
  assert.equal(actor.incarnation, 'account-v1')
  assert.strictEqual(actor.user, tokenUser)
  assert.equal(providerLookups, 0)
})

test('access token authority denies a missing ability before provider lookup', async ({
  assert,
}) => {
  const user = { id: 'a' }
  let providerLookups = 0
  const provider: AccessTokensUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async () => {
      providerLookups++
      return { getId: () => 'a', getOriginal: () => user }
    },
    findById: async () => {
      providerLookups++
      return null
    },
    createToken: async () => ({}) as never,
    invalidateToken: async () => true,
    verifyToken: async () => null,
  }
  const native = accessTokensAuthority({
    namespace: 'users',
    guard: 'api',
    provider,
    ability: 'masquerade',
    incarnation: 'id',
    securityStamp: () => 'stamp',
    isActive: () => true,
  })
  let abilityResult: unknown = false
  const ctx = {
    auth: {
      use: () => ({
        driverName: 'access_tokens',
        authenticate: async () => ({
          ...user,
          currentAccessToken: { allows: () => abilityResult },
        }),
      }),
    },
  } as unknown as HttpContext

  assert.equal(await errorCode(() => native.authenticateActor(ctx)), 'E_MASQUERADE_NOT_ALLOWED')
  abilityResult = 1
  assert.equal(await errorCode(() => native.authenticateActor(ctx)), 'E_MASQUERADE_NOT_ALLOWED')
  assert.equal(providerLookups, 0)
})

test('access token authority preserves native 401 and sanitizes other native and provider failures', async ({
  assert,
}) => {
  const user = { id: 'a' }
  let authenticationFailure: unknown
  let providerFailure = false
  const provider: AccessTokensUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async () => {
      if (providerFailure) throw new Error('private provider detail')
      return { getId: () => 'a', getOriginal: () => user }
    },
    findById: async () => null,
    createToken: async () => ({}) as never,
    invalidateToken: async () => true,
    verifyToken: async () => null,
  }
  const native = accessTokensAuthority({
    namespace: 'users',
    guard: 'api',
    provider,
    ability: 'masquerade',
    incarnation: 'id',
    securityStamp: () => 'stamp',
    isActive: () => true,
  })
  const ctx = {
    auth: {
      use: () => ({
        driverName: 'access_tokens',
        authenticate: async () => {
          if (authenticationFailure) throw authenticationFailure
          return { ...user, currentAccessToken: { allows: () => true } }
        },
      }),
    },
  } as unknown as HttpContext

  authenticationFailure = new errors.E_UNAUTHORIZED_ACCESS('Invalid bearer token', {
    guardDriverName: 'access_tokens',
  })
  await assert.rejects(() => native.authenticateActor(ctx), 'Invalid bearer token')
  authenticationFailure = new Error('private native detail')
  assert.equal(await errorCode(() => native.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
  authenticationFailure = undefined
  providerFailure = true
  assert.equal(await errorCode(() => native.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
})

test('access token authority rejects non-access-token guards before authentication', async ({
  assert,
}) => {
  const user = { id: 'a' }
  const provider: AccessTokensUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async () => ({ getId: () => 'a', getOriginal: () => user }),
    findById: async () => null,
    createToken: async () => ({}) as never,
    invalidateToken: async () => true,
    verifyToken: async () => null,
  }
  const native = accessTokensAuthority({
    namespace: 'users',
    guard: 'api',
    provider,
    ability: 'masquerade',
    incarnation: 'id',
    securityStamp: () => 'stamp',
    isActive: () => true,
  })
  let authentications = 0
  const ctx = {
    auth: {
      use: () => ({
        driverName: 'session',
        authenticate: async () => {
          authentications++
          return user
        },
      }),
    },
  } as unknown as HttpContext

  assert.equal(await errorCode(() => native.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
  assert.equal(authentications, 0)
})

test('access token authority shares the exact supplied authority and validates options', async ({
  assert,
}) => {
  const user = { id: 'a' }
  const provider: AccessTokensUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async () => ({ getId: () => 'a', getOriginal: () => user }),
    findById: async () => null,
    createToken: async () => ({}) as never,
    invalidateToken: async () => true,
    verifyToken: async () => null,
  }
  const authority = {
    namespace: 'users',
    guard: 'web',
    accountPrefix: 'shared',
    incarnation(model: { id: string }) {
      return `${this.accountPrefix}-${model.id}`
    },
    securityStamp: () => 'stamp',
    inspectAccount: async () => null,
  }
  const native = accessTokensAuthority({ authority, guard: 'api', provider, ability: 'masquerade' })
  assert.strictEqual(native.authority, authority)
  assert.equal(native.guard, 'api')
  const ctx = {
    auth: {
      use: () => ({
        driverName: 'access_tokens',
        authenticate: async () => ({ ...user, currentAccessToken: { allows: () => true } }),
      }),
    },
  } as unknown as HttpContext
  const actor = await native.authenticateActor(ctx)
  assert.equal(actor.incarnation, 'shared-a')
  assert.throws(
    () =>
      accessTokensAuthority({
        authority,
        namespace: 'other',
        guard: 'api',
        provider,
        ability: 'masquerade',
      } as never),
    'Invalid native access tokens authority'
  )
  assert.throws(
    () =>
      accessTokensAuthority({
        namespace: 'users',
        guard: '',
        provider,
        ability: '   ',
        incarnation: 'id',
        securityStamp: () => 'stamp',
        isActive: () => true,
      }),
    'Invalid native access tokens authority'
  )
})

test('standalone token inspection reports the account state, incarnation and stamp', async ({
  assert,
}) => {
  const user = { key: 7, epoch: 'v2', stamp: 'stamp-7' }
  let active: unknown = false
  const adapter = accessTokensAuthority({
    guard: 'api',
    ability: 'masquerade',
    namespace: 'users',
    provider: {
      [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
      createUserForGuard: async (model: typeof user) => ({
        getId: () => model.key,
        getOriginal: () => model,
      }),
      findById: async (id: string) =>
        id === '7' ? { getId: () => user.key, getOriginal: () => user } : null,
    } as never,
    incarnation: (model: typeof user) => model.epoch,
    securityStamp: (model: typeof user) => model.stamp,
    isActive: async () => active as boolean,
  })
  const snapshot = await adapter.authority.inspectAccount('7')
  assert.deepEqual(
    { id: snapshot!.subject.id, incarnation: snapshot!.subject.incarnation },
    { id: '7', incarnation: 'v2' }
  )
  assert.isFalse(snapshot!.active)
  assert.equal(snapshot!.securityStamp, 'stamp-7')
  assert.isNull(await adapter.authority.inspectAccount('8'))
  active = 'false'
  assert.equal(
    await errorCode(() => adapter.authority.inspectAccount('7')),
    'E_MASQUERADE_UNAVAILABLE'
  )
})
