import { test } from '@japa/runner'
import { symbols } from '@adonisjs/auth'
import type { SessionUserProviderContract } from '@adonisjs/auth/types/session'
import type { HttpContext } from '@adonisjs/core/http'
import { sessionAuthority } from '../native/main.js'

test('native authority uses provider canonical identity rather than model id and preserves native user', async ({
  assert,
}) => {
  const user = { id: 'wrong', key: 42n, incarnation: 'account-v1', stamp: 'private' }
  const provider: SessionUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async (model) => ({ getId: () => model.key, getOriginal: () => model }),
    findById: async (id) =>
      id === '42' ? { getId: () => user.key, getOriginal: () => user } : null,
  }
  const native = sessionAuthority({
    namespace: 'users',
    guard: 'web',
    provider,
    incarnation: (model) => model.incarnation,
    securityStamp: (model) => model.stamp,
    isActive: async () => true,
  })
  const ctx = {
    auth: {
      use: (name: string) => {
        assert.equal(name, 'web')
        return { driverName: 'session', authenticate: async () => user }
      },
    },
  } as unknown as HttpContext
  const actor = await native.authenticateActor(ctx)
  assert.equal(actor.id, '42')
  assert.equal(actor.incarnation, 'account-v1')
  assert.strictEqual(actor.user, user)
  const snapshot = await native.authority.inspectAccount('42')
  assert.equal(snapshot!.subject.id, '42')
  assert.strictEqual(snapshot!.subject.user, user)
  assert.equal(snapshot!.securityStamp, 'private')
  assert.isTrue(snapshot!.active)
  assert.isNull(await native.authority.inspectAccount('missing'))
})

import { errors } from '@adonisjs/auth'
import { errorCode } from './helpers/core.js'

test('native adapter rejects malformed canonical identifiers and preserves native authentication errors', async ({
  assert,
}) => {
  const user = { key: 'a' }
  let identifier: unknown = 'a'
  const provider: SessionUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async () => ({
      getId: () => identifier as string,
      getOriginal: () => user,
    }),
    findById: async () => null,
  }
  const native = sessionAuthority({
    namespace: 'users',
    guard: 'web',
    provider,
    incarnation: () => 'one',
    securityStamp: () => 'stamp',
    isActive: () => true,
  })
  let failure: Error | undefined
  const ctx = {
    auth: {
      use: () => ({
        driverName: 'session',
        authenticate: async () => {
          if (failure) throw failure
          return user
        },
      }),
    },
  } as unknown as HttpContext
  for (const malformed of [
    null,
    {},
    [],
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    'x'.repeat(256),
    10n ** 256n,
  ]) {
    identifier = malformed
    assert.equal(await errorCode(() => native.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
  }
  identifier = 'a'
  failure = new errors.E_UNAUTHORIZED_ACCESS('Missing credential', { guardDriverName: 'session' })
  await assert.rejects(() => native.authenticateActor(ctx), 'Missing credential')
  failure = new Error('native infrastructure failed')
  assert.equal(await errorCode(() => native.authenticateActor(ctx)), 'E_MASQUERADE_UNAVAILABLE')
})

test('native adapter retains configured namespace/guard and callback receivers', async ({
  assert,
}) => {
  const user = { key: 7 }
  const provider: SessionUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async () => ({ getId: () => user.key, getOriginal: () => user }),
    findById: async () => ({ getId: () => user.key, getOriginal: () => user }),
  }
  class Options {
    namespace = 'users'
    guard = 'web'
    provider = provider
    #incarnation = 'one'
    incarnation() {
      return this.#incarnation
    }
    securityStamp() {
      return this.#incarnation
    }
    isActive() {
      return true
    }
  }
  const options = new Options()
  const native = sessionAuthority(options)
  assert.isTrue(Object.isFrozen(native.authority))
  assert.isFalse(Reflect.set(native.authority, 'guard', 'other'))
  assert.isFalse(Reflect.set(native.authority, 'namespace', 'other'))
  assert.isFalse(Object.isFrozen(provider))
  assert.isFalse(Object.isFrozen(user))
  options.guard = 'other'
  const ctx = {
    auth: {
      use: (name: string) => {
        assert.equal(name, 'web')
        return { driverName: 'session', authenticate: async () => user }
      },
    },
  } as unknown as HttpContext
  const actor = await native.authenticateActor(ctx)
  assert.equal(actor.id, '7')
  const snapshot = await native.authority.inspectAccount('7')
  assert.equal(snapshot!.subject.incarnation, 'one')
  assert.equal(snapshot!.securityStamp, 'one')
})

test('native adapter rejects an actual non-session raw guard before credential validation', async ({
  assert,
}) => {
  const user = { id: 'a' }
  let authentications = 0
  const provider: SessionUserProviderContract<typeof user> = {
    [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
    createUserForGuard: async () => ({ getId: () => 'a', getOriginal: () => user }),
    findById: async () => null,
  }
  const native = sessionAuthority({
    namespace: 'users',
    guard: 'web',
    provider,
    incarnation: 'id',
    securityStamp: () => 'stamp',
    isActive: () => true,
  })
  const ctx = {
    auth: {
      use: () => ({
        driverName: 'access_tokens',
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

test('native session inspection reports isActive exactly and rejects a non-boolean', async ({
  assert,
}) => {
  const user = { key: 7 }
  let active: unknown = false
  const native = sessionAuthority({
    namespace: 'users',
    guard: 'web',
    provider: {
      [symbols.PROVIDER_REAL_USER]: undefined as unknown as typeof user,
      createUserForGuard: async (model) => ({ getId: () => model.key, getOriginal: () => model }),
      findById: async () => ({ getId: () => user.key, getOriginal: () => user }),
    },
    incarnation: 'id',
    securityStamp: () => 'stamp',
    isActive: async () => active as boolean,
  })
  assert.isFalse((await native.authority.inspectAccount('7'))!.active)
  active = 'false'
  assert.equal(
    await errorCode(() => native.authority.inspectAccount('7')),
    'E_MASQUERADE_UNAVAILABLE'
  )
})
