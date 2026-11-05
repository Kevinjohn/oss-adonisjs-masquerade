import { test } from '@japa/runner'
import { errors, symbols } from '@adonisjs/auth'
import { tokensGuard } from '@adonisjs/auth/access_tokens'
import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import { EffectiveAccessTokensGuard } from '../auth/effective_access_tokens_guard.js'
import { effectiveAccessTokensGuard } from '../auth/main.js'
import { markContextEnforced } from '../src/integration/context_enforcement.js'
import { errorCode } from './helpers/core.js'
import { MasqueradeError } from '../src/errors.js'

test('effective token factory preserves nominal users without inferring actor token metadata', ({
  assert,
}) => {
  class User {
    #id = 'target'
    get id() {
      return this.#id
    }
  }
  // This configuration is inspected only by the type checker; no provider method is invoked.
  const configured = effectiveAccessTokensGuard(
    tokensGuard({ provider: {} as AccessTokensUserProviderContract<User> }),
    { guard: 'api' }
  )
  type Factory = Awaited<ReturnType<typeof configured.resolver>>
  type EffectiveUser = Awaited<ReturnType<ReturnType<Factory>['authenticate']>>
  function acceptsEffectiveUser(user: EffectiveUser): User {
    // @ts-expect-error The effective user does not acquire the raw actor's currentAccessToken.
    void user.currentAccessToken
    return user
  }
  assert.equal(acceptsEffectiveUser(new User()).id, 'target')
})

test('default effective token facade uses selected token actor and target, never cookie actor', async ({
  assert,
}) => {
  const cookie = { id: 'cookie' }
  const token = { id: 'token', currentAccessToken: { id: 1 } }
  const target = { id: 'target' }
  const raw = {
    [symbols.GUARD_KNOWN_EVENTS]: undefined,
    driverName: 'access_tokens',
    authenticate: async () => token,
    authenticateAsClient: async () => ({}),
  } as unknown as GuardContract<typeof token>
  const names: string[] = []
  const ctx = {
    route: { middleware: { all: () => [{ name: 'auth', args: [{ guards: ['api_effective'] }] }] } },
    auth: {
      use: (name: string) => {
        names.push(name)
        return name === 'web' ? { authenticate: async () => cookie } : raw
      },
    },
    containerResolver: {
      make: async () => ({
        selectGuard: () => ({ kind: 'effective', raw: 'api' }),
        admit: async () => ({ context: { isMasquerading: true }, effective: { user: target } }),
      }),
    },
  } as unknown as HttpContext
  const effective = new EffectiveAccessTokensGuard(ctx, raw, 'api')
  // Without masqueradeContext, view-only and sensitive() are unenforced: the target is refused.
  assert.equal(await errorCode(() => effective.authenticate()), 'E_MASQUERADE_UNAVAILABLE')
  assert.isFalse(effective.isAuthenticated)
  markContextEnforced(ctx)
  assert.deepEqual(await effective.authenticate(), target)
  assert.deepEqual(names, [])
})

test('default silent auth on an explicit raw api route chooses api, not cookie', async ({
  assert,
}) => {
  const token = { id: 'token', currentAccessToken: { id: 1 } }
  const raw = { driverName: 'access_tokens', authenticate: async () => token } as GuardContract<
    typeof token
  >
  const names: string[] = []
  const ctx = {
    auth: {
      use: (name: string) => {
        names.push(name)
        return raw
      },
    },
    containerResolver: { make: async () => ({ selectGuard: () => ({ kind: 'raw', raw: 'api' }) }) },
  } as unknown as HttpContext
  const effective = new EffectiveAccessTokensGuard(ctx, raw, 'api')
  assert.deepEqual(await effective.authenticate(), token)
  assert.deepEqual(names, ['api'])
})

test('token facade on a public route authenticates its own token guard, not the primary cookie guard', async ({
  assert,
}) => {
  const token = { id: 'token', currentAccessToken: { id: 1 } }
  const raw = { driverName: 'access_tokens', authenticate: async () => token } as GuardContract<
    typeof token
  >
  const names: string[] = []
  const ctx = {
    route: { middleware: { all: () => [] } },
    auth: {
      use: (name: string) => {
        names.push(name)
        return name === 'web' ? { authenticate: async () => ({ id: 'cookie' }) } : raw
      },
    },
    containerResolver: {
      make: async () => ({ selectGuard: () => ({ kind: 'none', raw: 'web' }) }),
    },
  } as unknown as HttpContext
  const effective = new EffectiveAccessTokensGuard(ctx, raw, 'api')
  assert.deepEqual(await effective.authenticate(), token)
  assert.notInclude(names, 'web')
})

test('token facade check, getUserOrFail and failure reset match the native token guard', async ({
  assert,
}) => {
  const actor = { id: 'actor', currentAccessToken: { id: 1 } }
  const target = { id: 'target' }
  let credential = false
  let failure: Error | undefined
  const raw = {
    [symbols.GUARD_KNOWN_EVENTS]: undefined,
    driverName: 'access_tokens',
    authenticate: async () => {
      if (!credential)
        throw new errors.E_UNAUTHORIZED_ACCESS('Unauthorized access', {
          guardDriverName: 'access_tokens',
        })
      return actor
    },
    authenticateAsClient: async () => ({}),
  } as unknown as GuardContract<typeof actor>
  const ctx = {
    route: { middleware: { all: () => [{ name: 'auth', args: [{ guards: ['api_effective'] }] }] } },
    auth: { use: () => raw },
    containerResolver: {
      make: async () => ({
        selectGuard: () => ({ kind: 'effective', raw: 'api' }),
        admit: async () => {
          if (failure) throw failure
          await raw.authenticate()
          return { context: { isMasquerading: true }, effective: { user: target } }
        },
      }),
    },
  } as unknown as HttpContext
  markContextEnforced(ctx)
  const effective = new EffectiveAccessTokensGuard(ctx, raw, 'api')
  assert.throws(() => effective.getUserOrFail(), 'No effective user is authenticated')
  assert.isFalse(await effective.check())
  assert.isTrue(effective.authenticationAttempted)
  assert.throws(() => effective.getUserOrFail(), 'Unauthorized access')
  credential = true
  assert.isTrue(await effective.check())
  assert.strictEqual(effective.getUserOrFail(), target)
  failure = new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
  await assert.rejects(() => effective.check(), 'Masquerade context changed')
  assert.isUndefined(effective.user)
  assert.isFalse(effective.isAuthenticated)
})

test('token facade rejects a raw guard that is not an access_tokens guard', ({ assert }) => {
  assert.throws(
    () =>
      new EffectiveAccessTokensGuard(
        {} as HttpContext,
        { driverName: 'session' } as GuardContract<unknown>,
        'web'
      ),
    'Masquerade requires a native access_tokens guard'
  )
})
