import { test } from '@japa/runner'
import { errorCode, fixture } from './helpers/core.js'
import { createRuntime, runtimeConfiguration } from '../integration/runtime_factory.js'
import { markEffectiveFactory } from '../integration/guard_registration.js'
import { contextToken } from '../src/context_token.js'
import { masqueradeContext } from '../http/context_middleware.js'
import { EffectiveSessionGuard } from '../auth/effective_session_guard.js'

const raw = () => ({})
const effective = (guard: string) => markEffectiveFactory(() => ({}), guard)

function configuration(
  adapters: Record<string, unknown>,
  guards: Record<string, unknown>,
  defaultGuard = 'web_effective'
) {
  const f = fixture()
  const authority = f.config.authority
  const primary = { authority, authenticateActor: async () => f.users.get('a')! }
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
  return { app, authority, native, auth }
}

test('runtime accepts one authority across raw guards and maps every effective factory', async ({
  assert,
}) => {
  const f = configuration({}, { web_effective: effective('web'), alias: effective('web') })
  const token = { authority: f.authority, guard: 'api', authenticateActor: async () => ({}) }
  f.native.adapters.api = token
  const guards = f.auth.config.guards
  guards.api = raw
  guards.api_effective = effective('api')
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
  const tokenStatus = await runtime.service.status({ route: tokenRoute } as never)
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
