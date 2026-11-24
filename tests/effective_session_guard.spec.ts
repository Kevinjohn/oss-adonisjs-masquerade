import { test } from '@japa/runner'
import { errors, symbols } from '@adonisjs/auth'
import { SessionGuard } from '@adonisjs/auth/session'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import { EffectiveSessionGuard } from '../auth/effective_session_guard.js'
import { selectRouteGuard } from '../src/integration/route_guard_selection.js'

const selectGuard = (ctx: HttpContext) =>
  selectRouteGuard({
    route: ctx.route,
    defaultGuard: 'web_effective',
    effectiveRawGuards: { web_effective: 'web' },
    registeredRawGuards: ['web'],
    primaryRawGuard: 'web',
  })

test('raw/public requests authenticate natively without reading mode state', async ({ assert }) => {
  let runtimeResolutions = 0
  let modeReads = 0
  let rawAuthentications = 0
  const actor = { id: 'actor' }
  const raw = {
    driverName: 'session',
    async authenticate() {
      rawAuthentications++
      return actor
    },
    authenticateAsClient: async (user: typeof actor) => ({ session: { userId: user.id } }),
  } as unknown as GuardContract<typeof actor>
  const ctx = {
    auth: {
      use: (name: string) => {
        assert.equal(name, 'web')
        return raw
      },
    },
    containerResolver: {
      make: async () => {
        runtimeResolutions++
        return {
          effectiveGuardName: 'web_effective',
          effectiveGuardNames: ['web_effective'],
          selectGuard,
          admit: async () => {
            modeReads++
            throw new Error('store offline')
          },
        }
      },
    },
  } as unknown as HttpContext
  const guard = new EffectiveSessionGuard('web', ctx, raw)
  assert.isTrue(await guard.check())
  assert.strictEqual(guard.user, actor)
  assert.equal(rawAuthentications, 1)
  ctx.route = {
    middleware: { all: () => [{ name: 'auth', args: [{ guards: ['web'] }] }] },
  } as never
  const controlGuard = new EffectiveSessionGuard('web', ctx, raw)
  assert.isTrue(await controlGuard.check())
  assert.strictEqual(controlGuard.user, actor)
  assert.equal(rawAuthentications, 2)
  assert.equal(modeReads, 0)
  assert.equal(runtimeResolutions, 2)
  assert.equal(guard.driverName, 'session')
  assert.deepEqual(await guard.authenticateAsClient(actor), { session: { userId: 'actor' } })
  assert.isTrue(Object.hasOwn(guard, symbols.GUARD_KNOWN_EVENTS))
})

test('only a genuine native unauthorized error becomes false', async ({ assert }) => {
  const native = new errors.E_UNAUTHORIZED_ACCESS('Authentication required', {
    guardDriverName: 'session',
  })
  let failure: unknown = native
  const raw = {
    driverName: 'session',
    authenticate: async () => {
      throw failure
    },
  } as unknown as GuardContract<unknown>
  const ctx = {
    auth: { use: () => raw },
    containerResolver: {
      make: async () => ({
        effectiveGuardName: 'web_effective',
        effectiveGuardNames: ['web_effective'],
        selectGuard,
      }),
    },
  } as unknown as HttpContext
  const guard = new EffectiveSessionGuard('web', ctx, raw)
  assert.isFalse(await guard.check())
  assert.isTrue(guard.authenticationAttempted)
  assert.isFalse(guard.isAuthenticated)
  failure = Object.assign(new Error('policy error'), { code: 'E_UNAUTHORIZED_ACCESS' })
  await assert.rejects(() => guard.check(), 'policy error')
  assert.isUndefined(guard.user)
})

test('getUserOrFail preserves native session unauthorized behavior after a failed check', async ({
  assert,
}) => {
  let native: GuardContract<unknown>
  const ctx = {
    session: { sessionId: 'session-1', get: () => undefined },
    request: { encryptedCookie: () => undefined },
    auth: { use: () => native },
    route: {
      middleware: { all: () => [{ name: 'auth', args: [{ guards: ['web'] }] }] },
    },
    containerResolver: {
      make: async () => ({ effectiveGuardNames: ['web_effective'], selectGuard }),
    },
  } as unknown as HttpContext
  native = new SessionGuard(
    'web',
    ctx,
    { useRememberMeTokens: false },
    { emit: async () => {} } as never,
    {} as never
  ) as unknown as GuardContract<unknown>
  const effective = new EffectiveSessionGuard('web', ctx, native)

  assert.throws(() => effective.getUserOrFail(), 'No effective user is authenticated')
  assert.isFalse(await native.check())
  assert.isFalse(await effective.check())

  let nativeError: unknown
  let effectiveError: unknown
  try {
    native.getUserOrFail()
  } catch (error) {
    nativeError = error
  }
  try {
    effective.getUserOrFail()
  } catch (error) {
    effectiveError = error
  }
  assert.instanceOf(nativeError, errors.E_UNAUTHORIZED_ACCESS)
  assert.instanceOf(effectiveError, errors.E_UNAUTHORIZED_ACCESS)
  type UnauthorizedError = InstanceType<typeof errors.E_UNAUTHORIZED_ACCESS>
  assert.equal((effectiveError as UnauthorizedError).code, (nativeError as UnauthorizedError).code)
  assert.equal(
    (effectiveError as UnauthorizedError).message,
    (nativeError as UnauthorizedError).message
  )
  assert.equal(
    (effectiveError as UnauthorizedError).status,
    (nativeError as UnauthorizedError).status
  )
  assert.equal((effectiveError as UnauthorizedError).guardDriverName, native.driverName)
})

import { Authenticator } from '@adonisjs/auth'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import { errors as masqueradeErrors } from '../index.js'
import { markContextEnforced } from '../src/integration/context_enforcement.js'

test('business guard owns the facade while the raw guard retains actor identity; failures never fall back', async ({
  assert,
}) => {
  const actor = { id: 'actor' }
  const target = { id: 'target' }
  const ctx = new HttpContextFactory().create()
  ctx.route = {
    middleware: { all: () => [{ name: 'auth', args: [{ guards: ['web_effective'] }] }] },
  } as never
  const raw: GuardContract<typeof actor> = {
    [symbols.GUARD_KNOWN_EVENTS]: undefined,
    driverName: 'session',
    user: actor,
    isAuthenticated: true,
    authenticationAttempted: true,
    authenticate: async () => actor,
    check: async () => true,
    getUserOrFail: () => actor,
    authenticateAsClient: async () => ({}),
  }
  let failure: InstanceType<typeof masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED> | undefined
  ctx.containerResolver.bindValue('masquerade.runtime', {
    selectGuard,
    admit: async () => {
      if (failure) throw failure
      return {
        context: { isMasquerading: true },
        actor: { user: actor },
        effective: { user: target },
      }
    },
  } as never)
  const auth = new Authenticator(ctx, {
    default: 'web_effective',
    guards: {
      web: () => raw,
      web_effective: () => new EffectiveSessionGuard('web', ctx, raw),
    },
  })
  ctx.auth = auth as never
  // Without masqueradeContext, view-only and sensitive() are unenforced: the target is refused.
  await assert.rejects(() => auth.check(), 'The request did not run the context middleware')
  assert.isUndefined(auth.use('web_effective').user)
  markContextEnforced(ctx)
  assert.isTrue(await auth.check())
  assert.strictEqual(auth.user, target)
  assert.strictEqual(auth.getUserOrFail(), target)
  assert.equal(auth.authenticatedViaGuard, 'web_effective')
  assert.strictEqual(auth.use('web').user, actor)
  // A raw logout later in the same request ends effective authentication, as it does natively.
  raw.isAuthenticated = false
  assert.isFalse(await auth.check())
  assert.isUndefined(auth.use('web_effective').user)
  raw.isAuthenticated = true
  failure = new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED()
  await assert.rejects(() => auth.check(), 'Masquerade context changed')
  assert.isUndefined(auth.use('web_effective').user)
  assert.isFalse(auth.use('web_effective').isAuthenticated)
  assert.strictEqual(auth.use('web').user, actor)
})

test('effective wrapper rejects non-session native drivers', ({ assert }) => {
  assert.throws(
    () =>
      new EffectiveSessionGuard(
        'api',
        {} as HttpContext,
        { driverName: 'access_tokens' } as GuardContract<unknown>
      ),
    'Masquerade requires a native session guard'
  )
})

test('default silent auth uses an unrelated registered raw guard without mode admission', async ({
  assert,
}) => {
  const member = { id: 'member' }
  let admissions = 0
  const names: string[] = []
  const raw = { driverName: 'session', authenticate: async () => member } as GuardContract<
    typeof member
  >
  const ctx = {
    auth: {
      use: (name: string) => {
        names.push(name)
        return raw
      },
    },
    containerResolver: {
      make: async () => ({
        selectGuard: () => ({ kind: 'raw', raw: 'members' }),
        admit: async () => {
          admissions++
          throw new Error('store reached')
        },
      }),
    },
  } as unknown as HttpContext
  const effective = new EffectiveSessionGuard('web', ctx, raw)
  assert.strictEqual(await effective.authenticate(), member)
  assert.deepEqual(names, ['members'])
  assert.equal(admissions, 0)
})

test('the effective session guard needs a raw guard with a different name', async ({ assert }) => {
  const { effectiveSessionGuard } = await import('../auth/define_config.js')
  const raw = { resolver: async () => () => ({ driverName: 'session' }) } as never
  const app = (guard?: string) =>
    ({ config: { get: () => (guard ? { authority: { guard } } : undefined) } }) as never
  for (const configured of ['web_effective', undefined])
    await assert.rejects(
      () => effectiveSessionGuard(raw).resolver('web_effective', app(configured)),
      'Configure distinct raw and effective session guards'
    )
  const factory = await effectiveSessionGuard(raw).resolver('web_effective', app('web'))
  assert.isFunction(factory)
})

test('without a configured authority the native adapter names the raw session guard', async ({
  assert,
}) => {
  const { effectiveSessionGuard } = await import('../auth/define_config.js')
  const raw = { resolver: async () => () => ({ driverName: 'session' }) } as never
  const app = (guard: string) =>
    ({
      config: { get: () => ({}) },
      container: { make: async () => ({ authority: { namespace: 'test', guard } }) },
    }) as never
  await assert.rejects(
    () => effectiveSessionGuard(raw).resolver('web_effective', app('web_effective')),
    'Configure distinct raw and effective session guards'
  )
  const factory = await effectiveSessionGuard(raw).resolver('web_effective', app('web'))
  assert.isFunction(factory)
})

test('context holds the admitted view-as context only when the effective guard was selected', async ({
  assert,
}) => {
  const actor = { id: 'actor' }
  const target = { id: 'target' }
  const context = { isMasquerading: true, effectiveId: 'target' }
  const raw = {
    driverName: 'session',
    isAuthenticated: true,
    authenticate: async () => actor,
  } as unknown as GuardContract<typeof actor>
  let selection: { kind: string; raw?: string } = { kind: 'effective', raw: 'web' }
  const ctx = {
    auth: { use: () => raw },
    containerResolver: {
      make: async () => ({
        selectGuard: () => selection,
        admit: async () => ({ context, effective: { user: target } }),
      }),
    },
  } as unknown as HttpContext
  markContextEnforced(ctx)
  const guard = new EffectiveSessionGuard('web', ctx, raw)
  assert.isUndefined(guard.context)
  assert.strictEqual(await guard.authenticate(), target)
  assert.strictEqual(guard.context, context as never)
  for (const other of [{ kind: 'raw', raw: 'web' }, { kind: 'ambiguous' }]) {
    selection = other
    assert.strictEqual(await guard.authenticate(), actor)
    assert.isUndefined(guard.context)
  }
})

test('a guard built by Account Kit accountKitSessionGuard passes the effective driver checks', async ({
  assert,
}) => {
  const { accountKitSessionGuard } = await import('@kevinjohn/adonisjs-account-kit/auth')
  const { effectiveSessionGuard } = await import('../auth/define_config.js')
  const { getEffectiveGuardDriver } = await import('../src/integration/guard_registration.js')
  const raw = accountKitSessionGuard({ provider: {} as never })
  const app = {
    config: { get: () => ({ authority: { guard: 'web' } }) },
    container: { make: async () => ({}) },
  } as never
  const rawFactory = await raw.resolver('web', app)
  const factory = await effectiveSessionGuard(raw).resolver('web_effective', app)
  // Runtime wiring constructs factories without a live request; the guard must not touch it.
  const ctx = Object.freeze({}) as unknown as HttpContext
  // The request-time check compares the raw guard's driver with the effective factory's driver.
  assert.equal(rawFactory(ctx).driverName, getEffectiveGuardDriver(factory))
  // The effective guard's constructor refuses a raw guard whose driver is not 'session'.
  assert.equal(factory(ctx).driverName, 'session')
})
