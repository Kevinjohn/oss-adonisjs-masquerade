import { test } from '@japa/runner'
import { assertManagedRouteRegistration } from '../account_kit/route_validation.js'
import { inspectRouteCoverage } from '../commands/routes.js'
import { activeMode } from '../src/active_mode.js'
import { fixture } from './helpers/core.js'

const managed = {
  root: [
    {
      name: 'accountKit.account.password.change',
      methods: ['PATCH'],
      pattern: '/auth/account/password',
      handler: () => {},
      middleware: { all: () => new Set() },
    },
  ],
}
const registration = {
  routes: [{ name: 'account.password.change', method: 'PATCH', path: '/auth/account/password' }],
}

test.group('Account Kit managed route coverage', () => {
  test('cross-checks registered name, method and path', ({ assert }) => {
    assert.doesNotThrow(() => assertManagedRouteRegistration(managed, registration))
    for (const route of [
      { ...registration.routes[0], name: 'account.password.reset' },
      { ...registration.routes[0], method: 'GET' },
      { ...registration.routes[0], path: '/other' },
    ])
      assert.throws(() => assertManagedRouteRegistration(managed, { routes: [route] }))
    assert.throws(() =>
      assertManagedRouteRegistration(
        { root: [{ ...managed.root[0], methods: ['PATCH', 'DELETE'] }] },
        registration
      )
    )
    assert.throws(() =>
      assertManagedRouteRegistration(
        { api: [{ ...managed.root[0], name: 'accountKit.unregistered' }] },
        registration
      )
    )
    assert.throws(() => assertManagedRouteRegistration({ root: [] }, registration), 'not mounted')
    assert.throws(
      () =>
        assertManagedRouteRegistration(
          { root: [{ ...managed.root[0], name: 'api.accountKit.account.password.change' }] },
          registration
        ),
      'not mounted'
    )
  })

  test('reports verified managed routes separately and unverified ones as uncovered', async ({
    assert,
  }) => {
    const uncoveredSections = await inspectRouteCoverage(managed, 'web')
    const uncovered = uncoveredSections.join('\n')
    assert.include(uncovered, '[UNCLASSIFIED MUTATION] (blocker missing or unverified)')
    const coveredSections = await inspectRouteCoverage(managed, 'web', 'web', ['web'], {}, true)
    const covered = coveredSections.join('\n')
    assert.include(covered, 'Account Kit managed\n')
    assert.include(covered, '[Account Kit managed (blocked while active) MUTATION]')
  })

  test('marks logout and CSRF as exempt in a verified route report', async ({ assert }) => {
    const exempt = {
      root: [
        { ...managed.root[0], name: 'accountKit.account.logout', methods: ['POST'] },
        { ...managed.root[0], name: 'accountKit.auth.csrf', methods: ['GET'] },
      ],
    }
    const sections = await inspectRouteCoverage(exempt, 'web', 'web', ['web'], {}, true)
    assert.equal(sections.join('\n').match(/Account Kit managed \(exempt\)/g)?.length, 2)
  })

  test('reads validated active state at the service clock without mutation', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    const check = (owner: typeof f.owner) =>
      (service as typeof service & { [activeMode](owner: typeof f.owner): Promise<boolean> })[
        activeMode
      ](owner)
    assert.isFalse(await check(f.owner))
    await f.start(service)
    const before = await f.store.read(f.owner)
    const events = f.store.events
    assert.isTrue(await check(f.owner))
    assert.isFalse(await check({ ...f.owner, actorIncarnation: 'other' }))
    await assert.rejects(
      () => check({ ...f.owner, namespace: 'other' }),
      'Masquerade is unavailable'
    )
    f.state.now = Date.parse(before!.expiresAt!)
    assert.isFalse(await check(f.owner))
    assert.deepEqual(await f.store.read(f.owner), before)
    assert.deepEqual(f.store.events, events)
  })

  test('treats a persisted idle row as inactive without changing it', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    const started = await f.start(service)
    await service.stop({}, { expectedContext: started.contextToken })
    const before = await f.store.read(f.owner)
    const events = f.store.events
    assert.equal(before?.state, 'idle')
    const active = await (
      service as typeof service & { [activeMode](owner: typeof f.owner): Promise<boolean> }
    )[activeMode](f.owner)
    assert.isFalse(active)
    assert.deepEqual(await f.store.read(f.owner), before)
    assert.deepEqual(f.store.events, events)
  })

  test('maps malformed rows and store failures to unavailable', async ({ assert }) => {
    for (const badRead of [
      async () => ({ state: 'active', namespace: 'other' }),
      async () => {
        throw new Error('store down')
      },
    ]) {
      const f = fixture()
      f.config.store = async () => Object.assign(Object.create(f.store), { read: badRead })
      const service = await f.create()
      const check = () =>
        (service as typeof service & { [activeMode](owner: typeof f.owner): Promise<boolean> })[
          activeMode
        ](f.owner)
      await assert.rejects(check, 'Masquerade is unavailable')
      assert.deepEqual(f.store.events, [])
    }
  })
})
