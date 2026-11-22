import { test } from '@japa/runner'
import { errorCode, fixture } from './helpers/core.js'
import { createRuntime, runtimeConfiguration } from '../src/integration/runtime_factory.js'
import { markEffectiveFactory } from '../src/integration/guard_registration.js'
import { contextToken } from '../src/context_token.js'
import { masqueradeContext } from '../http/context_middleware.js'
import { EffectiveSessionGuard } from '../auth/effective_session_guard.js'

const raw = () => ({})
const effective = (guard: string, driver: 'session' | 'access_tokens' = 'session') =>
  markEffectiveFactory(() => ({}), guard, driver)

function configuration(
  adapters: Record<string, unknown>,
  guards: Record<string, unknown>,
  defaultGuard = 'web_effective'
) {
  const f = fixture()
  const authority = f.config.authority
  const primary = {
    authority,
    driverName: 'session',
    authenticateActor: async () => f.users.get('a')!,
  }
  const native = { ...primary, adapters: { web: primary, ...adapters } as Record<string, unknown> }
  const auth = {
    defaultGuard,
    config: { guards: { web: raw, ...guards } as Record<string, unknown> },
  }
  const app = {
    config: { get: () => f.config },
    container: {
      make: async (name: string) => (name === 'masquerade.native' ? native : auth),
    },
  }
  return { app, authority, native, auth, fixture: f }
}

test('runtime accepts one authority across raw guards and maps every effective factory', async ({
  assert,
}) => {
  const f = configuration({}, { web_effective: effective('web'), alias: effective('web') })
  const token = { authority: f.authority, guard: 'api', authenticateActor: async () => ({}) }
  f.native.adapters.api = token
  const guards = f.auth.config.guards
  guards.api = raw
  guards.api_effective = effective('api', 'access_tokens')
  const wiring = await runtimeConfiguration(f.app as never)
  assert.equal(wiring.effectiveRawGuards.alias, 'web')
  assert.equal(wiring.effectiveRawGuards.api_effective, 'api')
  assert.strictEqual(wiring.rawAdapters.api, token)
  assert.deepEqual(wiring.registeredRawGuardNames, ['web', 'api'])
})

test('runtime rejects missing raw or unmapped effective factories at configuration', async ({
  assert,
}) => {
  const f = configuration({}, { web_effective: effective('web'), api_effective: effective('api') })
  await assert.rejects(
    () => runtimeConfiguration(f.app as never),
    'Effective masquerade guard api_effective has no registered raw adapter'
  )
  const g = configuration(
    { api: { guard: 'api', authority: {}, authenticateActor: async () => ({}) } },
    { web_effective: effective('web'), api: raw, api_effective: effective('api') }
  )
  await assert.rejects(
    () => runtimeConfiguration(g.app as never),
    'Native masquerade adapter map is invalid'
  )
})

test('boot rejects an effective guard whose transport differs from its raw adapter metadata', async ({
  assert,
}) => {
  const driver = (driverName: string) => () => ({ driverName })
  const f = configuration(
    {},
    { web_effective: markEffectiveFactory(driver('access_tokens'), 'web', 'access_tokens') }
  )
  await assert.rejects(
    () => runtimeConfiguration(f.app as never),
    'Effective masquerade guard web_effective wraps the access_tokens driver, but the adapter registered for raw guard web declares the session driver'
  )
  const g = configuration(
    {},
    { web_effective: markEffectiveFactory(driver('session'), 'web', 'session') }
  )
  const wiring = await runtimeConfiguration(g.app as never)
  assert.equal(wiring.effectiveRawGuards.web_effective, 'web')
})

test('a raw guard whose driver differs from agreeing metadata boots and refuses the effective route', async ({
  assert,
}) => {
  let authentication = 0
  const f = configuration(
    {},
    {
      web_effective: markEffectiveFactory(() => ({ driverName: 'session' }), 'web', 'session'),
      web: () => ({ driverName: 'access_tokens' }),
    }
  )
  f.native.adapters.web = {
    authority: f.authority,
    driverName: 'session',
    authenticateActor: async () => {
      authentication++
      return { id: 'a', incarnation: 'a', user: f.fixture.users.get('a')! }
    },
  }
  const wiring = await runtimeConfiguration(f.app as never)
  const runtime = await createRuntime(
    {
      nodeEnvironment: 'test',
      container: {
        make: async (name: string) =>
          name === 'emitter' ? { emit: async () => {} } : { info: () => {}, error: () => {} },
      },
    } as never,
    wiring
  )
  const ctx = {
    route: {
      middleware: { all: () => [{ name: 'auth', args: [{ guards: ['web_effective'] }] }] },
    },
    auth: { use: (name: string) => (f.auth.config.guards[name] as () => unknown)() },
  }
  assert.equal(
    await errorCode(() => runtime.service.status(ctx as never)),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(authentication, 0)
})

test('guard factories only run on a live request; cross-wired guards fail before actor authentication and store reads', async ({
  assert,
}) => {
  let constructions = 0
  let authentication = 0
  let reads = 0
  const session = (ctx: { request: { method(): string } }) => {
    constructions++
    ctx.request.method()
    return { driverName: 'session' }
  }
  const effectiveFactory = markEffectiveFactory(
    (ctx: Parameters<typeof session>[0]) => session(ctx),
    'web',
    'session'
  )
  const f = configuration({}, { web_effective: effectiveFactory, web: session })
  const originalRead = f.fixture.store.read.bind(f.fixture.store)
  f.fixture.store.read = async (owner) => {
    reads++
    return originalRead(owner)
  }
  f.native.adapters.web = {
    authority: f.authority,
    driverName: 'session',
    authenticateActor: async () => {
      authentication++
      return { id: 'a', incarnation: 'a', user: f.fixture.users.get('a')! }
    },
  }
  const wiring = await runtimeConfiguration(f.app as never)
  assert.equal(constructions, 0)
  const runtime = await createRuntime(
    {
      nodeEnvironment: 'test',
      container: {
        make: async (name: string) =>
          name === 'emitter' ? { emit: async () => {} } : { info: () => {}, error: () => {} },
      },
    } as never,
    wiring
  )
  const route = {
    middleware: { all: () => [{ name: 'auth', args: [{ guards: ['web_effective'] }] }] },
  }
  const ctx = {
    route,
    request: { method: () => 'GET' },
    auth: {
      use(name: string) {
        return (f.auth.config.guards[name] as typeof session)(ctx)
      },
    },
  }
  await runtime.service.status(ctx as never)
  assert.equal(constructions, 2)
  assert.equal(authentication, 1)
  assert.equal(reads, 1)
  // The real raw guard may differ from the factory wrapped by the effective config.
  f.auth.config.guards.web = () => ({ driverName: 'access_tokens' })
  assert.equal(
    await errorCode(() => runtime.service.status(ctx as never)),
    'E_MASQUERADE_UNAVAILABLE'
  )
  // The effective constructor may itself refuse the wrapped factory on a live request.
  f.auth.config.guards.web_effective = () =>
    new EffectiveSessionGuard('web', ctx as never, { driverName: 'access_tokens' } as never)
  assert.equal(
    await errorCode(() => runtime.service.status(ctx as never)),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(authentication, 1)
  assert.equal(reads, 1)
})

test('a cross-wired or failing guard on a live request is logged before the unchanged 503', async ({
  assert,
}) => {
  const session = () => ({ driverName: 'session' })
  const f = configuration(
    {},
    { web_effective: markEffectiveFactory(() => session(), 'web', 'session'), web: session }
  )
  const wiring = await runtimeConfiguration(f.app as never)
  const runtime = await createRuntime(
    {
      nodeEnvironment: 'test',
      container: {
        make: async (name: string) =>
          name === 'emitter' ? { emit: async () => {} } : { info: () => {}, error: () => {} },
      },
    } as never,
    wiring
  )
  const logged: Array<{ fields: Record<string, unknown>; message: string }> = []
  const ctx = {
    route: {
      middleware: { all: () => [{ name: 'auth', args: [{ guards: ['web_effective'] }] }] },
    },
    logger: {
      error: (fields: Record<string, unknown>, message: string) => logged.push({ fields, message }),
    },
    auth: {
      use: (name: string) => (f.auth.config.guards[name] as () => unknown)(),
    },
  }
  f.auth.config.guards.web = () => ({ driverName: 'access_tokens' })
  const crossWired = await runtime.service.status(ctx as never).catch((error) => error)
  assert.equal(crossWired.code, 'E_MASQUERADE_UNAVAILABLE')
  assert.equal(crossWired.message, 'Masquerade is unavailable')
  assert.equal(crossWired.status, 503)
  assert.isUndefined(crossWired.cause)
  assert.deepEqual(logged, [
    {
      fields: {
        code: 'E_MASQUERADE_UNAVAILABLE',
        component: 'guard_wiring',
        effectiveGuard: 'web_effective',
        rawGuard: 'web',
        guard: 'web',
        expectedDriver: 'session',
        actualDriver: 'access_tokens',
      },
      message: 'Masquerade effective guard and its raw guard use different drivers',
    },
  ])
  logged.length = 0
  f.auth.config.guards.web = () => {
    throw new Error('Host guard factory failed')
  }
  const failed = await runtime.service.status(ctx as never).catch((error) => error)
  assert.equal(failed.code, 'E_MASQUERADE_UNAVAILABLE')
  assert.isUndefined(failed.cause)
  assert.deepEqual(logged, [
    {
      fields: {
        code: 'E_MASQUERADE_UNAVAILABLE',
        component: 'guard_wiring',
        effectiveGuard: 'web_effective',
        rawGuard: 'web',
        guard: 'web',
        error: 'Host guard factory failed',
      },
      message: 'Masquerade could not construct a guard for the effective route',
    },
  ])
})

test('runtime service uses route-selected token actor despite a conflicting cookie actor', async ({
  assert,
}) => {
  const f = fixture()
  const subject = (id: string) => ({ id, incarnation: id, user: f.users.get(id)! })
  const web = { authority: f.config.authority, authenticateActor: async () => subject('a') }
  const api = {
    authority: f.config.authority,
    guard: 'api',
    authenticateActor: async () => subject('b'),
  }
  const adapters = Object.freeze({ web, api })
  const wiring = {
    config: f.config,
    native: { ...web, adapters },
    effectiveGuardName: 'web_effective',
    effectiveGuardNames: ['web_effective', 'api_effective'],
    effectiveRawGuards: Object.freeze({ web_effective: 'web', api_effective: 'api' }),
    effectiveDrivers: Object.freeze({ web_effective: 'session', api_effective: 'access_tokens' }),
    registeredRawGuardNames: ['web', 'api'],
    rawAdapters: adapters,
  }
  const app = {
    nodeEnvironment: 'test',
    container: {
      make: async (name: string) =>
        name === 'emitter' ? { emit: async () => {} } : { info: () => {}, error: () => {} },
    },
  }
  const runtime = await createRuntime(app as never, wiring as never)
  const tokenRoute = {
    middleware: { all: () => [{ name: 'auth', args: [{ guards: ['api_effective'] }] }] },
  }
  const tokenStatus = await runtime.service.status({
    route: tokenRoute,
    auth: { use: () => ({ driverName: 'access_tokens' }) },
  } as never)
  const noRouteStatus = await runtime.service.status({} as never)
  assert.equal(
    tokenStatus.contextToken,
    contextToken({ namespace: 'test', actorId: 'b', actorIncarnation: 'b' }, null)
  )
  assert.equal(
    noRouteStatus.contextToken,
    contextToken({ namespace: 'test', actorId: 'a', actorIncarnation: 'a' }, null)
  )
})

test('unrelated registered raw guard passes selection but cannot enter the service', async ({
  assert,
}) => {
  const f = fixture()
  let reads = 0
  const read = f.store.read.bind(f.store)
  f.store.read = async (owner) => {
    reads++
    return read(owner)
  }
  const web = {
    authority: f.config.authority,
    authenticateActor: async () => {
      throw new Error('cookie must not authenticate')
    },
  }
  const adapters = Object.freeze({ web })
  const wiring = {
    config: f.config,
    native: { ...web, adapters },
    effectiveGuardName: 'web_effective',
    effectiveGuardNames: ['web_effective'],
    effectiveRawGuards: Object.freeze({ web_effective: 'web' }),
    registeredRawGuardNames: ['web', 'members'],
    rawAdapters: adapters,
  }
  const app = {
    nodeEnvironment: 'test',
    container: {
      make: async (name: string) =>
        name === 'emitter' ? { emit: async () => {} } : { info: () => {}, error: () => {} },
    },
  }
  const runtime = await createRuntime(app as never, wiring as never)
  const route = { middleware: { all: () => [{ name: 'auth', args: [{ guards: ['members'] }] }] } }
  assert.deepEqual(runtime.selectGuard({ route } as never), { kind: 'raw', raw: 'members' })
  assert.equal(
    await errorCode(() => runtime.service.status({ route } as never)),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(reads, 0)
  const unknown = { middleware: { all: () => [{ name: 'auth', args: [{ guards: ['missing'] }] }] } }
  assert.equal(
    await errorCode(() => runtime.service.status({ route: unknown } as never)),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(reads, 0)
})

test('a route accepting several raw guards keeps native auth but cannot enter the service', async ({
  assert,
}) => {
  const f = fixture()
  let reads = 0
  const read = f.store.read.bind(f.store)
  f.store.read = async (owner) => {
    reads++
    return read(owner)
  }
  const web = {
    authority: f.config.authority,
    authenticateActor: async () => f.users.get('a')!,
  }
  const adapters = Object.freeze({ web })
  const wiring = {
    config: f.config,
    native: { ...web, adapters },
    effectiveGuardName: 'web_effective',
    effectiveGuardNames: ['web_effective'],
    effectiveRawGuards: Object.freeze({ web_effective: 'web' }),
    registeredRawGuardNames: ['web', 'api'],
    rawAdapters: adapters,
  }
  const app = {
    nodeEnvironment: 'test',
    container: {
      make: async (name: string) =>
        name === 'emitter' ? { emit: async () => {} } : { info: () => {}, error: () => {} },
    },
  }
  const runtime = await createRuntime(app as never, wiring as never)
  const route = {
    middleware: { all: () => [{ name: 'auth', args: [{ guards: ['web', 'api'] }] }] },
  }
  const member = { id: 'member' }
  const names: string[] = []
  const rawGuard = { driverName: 'session', authenticate: async () => member }
  const ctx = {
    route,
    auth: {
      defaultGuard: 'web_effective',
      use: (name: string) => {
        names.push(name)
        return rawGuard
      },
    },
    response: { header: () => {}, vary: () => {} },
    containerResolver: { make: async () => runtime },
  }
  let continued = false
  await masqueradeContext(ctx as never, async () => {
    continued = true
  })
  assert.isTrue(continued)
  const silent = new EffectiveSessionGuard('web', ctx as never, rawGuard as never)
  assert.isTrue(await silent.check())
  assert.deepEqual(names, ['web'])
  assert.equal(
    await errorCode(() => runtime.service.status(ctx as never)),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(reads, 0)
})
