import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'
import { IgnitorFactory } from '@adonisjs/core/factories'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Router } from '@adonisjs/core/http'
import type { HttpContext } from '@adonisjs/core/http'
import { test } from '@japa/runner'
import AccountKitProvider from '../account_kit/provider.js'
import AccountKitBlocker from '../account_kit/middleware.js'
import { hasVerifiedAccountKitBlocker } from '../src/integration/account_kit_status.js'

function canLoadKit(): boolean {
  if (process.env.ACCOUNT_KIT_SOURCE) return true
  try {
    import.meta.resolve('adonisjs-account-kit/http')
    return true
  } catch {
    return false
  }
}

if (process.env.ACCOUNT_KIT_SOURCE) {
  const entry = pathToFileURL(resolve(process.env.ACCOUNT_KIT_SOURCE, 'build/http/main.js')).href
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'adonisjs-account-kit/http') return { url: entry, shortCircuit: true }
      return nextResolve(specifier, context)
    },
  })
}

async function register(
  router: Router,
  name = 'web',
  strategy = 'session',
  group?: string
): Promise<void> {
  const packagePath = 'adonisjs-account-kit/http'
  const kit = await import(packagePath)
  const mount = () =>
    kit.registerManagedRoutes(router, {
      prefix: '/kit',
      kit: async () => ({}),
      guard: { strategy, name, forRequest: () => ({}), current: async () => ({}) },
      enabled: ['passwordReset'],
    })
  if (group) router.group(mount).prefix('/api').as(group)
  else mount()
}

async function fixture(
  options: {
    blocker?: boolean
    inlineBlocker?: boolean
    name?: string
    strategy?: string
    identifier?: unknown
    environment?: string
    group?: string
  } = {}
) {
  const app = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .create(new URL('../', import.meta.url))
    .createApp('web')
  await app.init()
  await app.boot()
  const router = await app.container.make('router')
  if (options.blocker !== false)
    router.use([
      options.inlineBlocker
        ? async () => ({ default: AccountKitBlocker })
        : () => import('../account_kit/middleware.js'),
    ])
  await register(router, 'web', 'session', options.group)
  const adapter = {
    authority: {
      namespace: 'users',
      incarnation: (user: { generation: string }) => user.generation,
    },
    provider: {
      createUserForGuard: async (_user: unknown) => ({ getId: () => options.identifier ?? 42 }),
    },
    authenticateActor: async () => {
      throw new Error('ability absent')
    },
    managedGuard: { name: options.name ?? 'web', strategy: options.strategy ?? 'session' },
    kit: async () => ({
      managedHttp: {
        assertGuard(guard: { name: string; strategy: string }) {
          if (guard.name !== 'web' || guard.strategy !== 'session')
            throw new TypeError('wrong guard')
        },
      },
    }),
  }
  const providerApp = {
    container: { make: async (key: string) => (key === 'router' ? router : adapter) },
    getEnvironment: () => options.environment ?? 'console',
  } as unknown as ApplicationService
  return { app, router, adapter, providerApp, provider: new AccountKitProvider(providerApp) }
}

async function block(
  host: Awaited<ReturnType<typeof fixture>>,
  name: string,
  options: {
    authenticated?: boolean
    active?: boolean
    failure?: 'guard' | 'store'
    missingUser?: boolean
  } = {}
) {
  const reads: unknown[] = []
  let nextCalls = 0
  const user = { generation: 'second' }
  const ctx = {
    route: { name },
    auth: {
      use: () => {
        if (options.failure === 'guard') throw new Error('guard unavailable')
        return {
          user: options.missingUser ? undefined : user,
          check: async () => options.authenticated ?? true,
        }
      },
    },
    containerResolver: {
      make: async (key: string) => {
        if (key === 'router') return host.router
        if (key === 'masquerade.native') return host.adapter
        if (key === 'masquerade.runtime')
          return {
            activeMode: async (owner: unknown) => {
              reads.push(owner)
              if (options.failure === 'store') throw new Error('store unavailable')
              return options.active ?? false
            },
          }
        throw new Error(`unexpected ${key}`)
      },
    },
  } as unknown as HttpContext
  const call = () =>
    new AccountKitBlocker().handle(ctx, async () => {
      nextCalls++
      return 'next'
    })
  return { call, reads, nextCalls: () => nextCalls }
}

test.group('Account Kit provider', () => {
  test('requires the native adapter and managed HTTP service before route validation', async ({
    assert,
  }) => {
    for (const missing of ['adapter', 'managedHttp'] as const) {
      const host = await fixture()
      try {
        if (missing === 'adapter') {
          delete (host.adapter as { kit?: unknown }).kit
        } else {
          host.adapter.kit = async () => ({ managedHttp: undefined }) as never
        }
        await assert.rejects(
          () => host.provider.ready(),
          missing === 'adapter'
            ? 'Account Kit native adapter required'
            : 'Account Kit managed HTTP service required'
        )
      } finally {
        await host.app.terminate()
      }
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('commits and verifies registered routes and installed blocker at console ready', async ({
    assert,
  }) => {
    const host = await fixture()
    try {
      assert.isFalse(host.router.commited)
      await host.provider.ready()
      assert.isTrue(host.router.commited)
      assert.isTrue(hasVerifiedAccountKitBlocker(host.providerApp))
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('leaves the router uncommitted and the blocker unverified outside the console', async ({
    assert,
  }) => {
    const host = await fixture({ environment: 'web' })
    try {
      await host.provider.ready()
      assert.isFalse(host.router.commited)
      assert.isFalse(hasVerifiedAccountKitBlocker(host.providerApp))
      host.router.commit()
      await host.provider.ready()
      assert.isTrue(hasVerifiedAccountKitBlocker(host.providerApp))
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('recognizes an inline lazy loader for the same blocker class', async ({ assert }) => {
    const host = await fixture({ inlineBlocker: true })
    try {
      await host.provider.ready()
      assert.isTrue(hasVerifiedAccountKitBlocker(host.providerApp))
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('does not invoke raw inline route middleware while verifying blocker installation', async ({
    assert,
  }) => {
    const host = await fixture()
    try {
      host.router.commit()
      let calls = 0
      const rawRequestMiddleware = async () => {
        calls++
      }
      for (const route of host.router.toJSON().root ?? []) {
        if (!route.name?.startsWith('accountKit.')) continue
        const original = route.middleware.all.bind(route.middleware)
        route.middleware.all = () => new Set([...original(), rawRequestMiddleware])
      }
      await host.provider.ready()
      assert.equal(calls, 0)
      assert.isTrue(hasVerifiedAccountKitBlocker(host.providerApp))
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  for (const [label, values] of [
    ['name', { name: 'wrong' }],
    ['strategy', { strategy: 'access_tokens' }],
  ] as const)
    test(`rejects mismatched managed guard ${label}`, async ({ assert }) => {
      const host = await fixture(values)
      try {
        await assert.rejects(() => host.provider.ready(), 'wrong guard')
      } finally {
        await host.app.terminate()
      }
    }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('rejects managed routes renamed by a route group', async ({ assert }) => {
    const host = await fixture({ group: 'api' })
    try {
      await assert.rejects(() => host.provider.ready(), /is not mounted/)
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('rejects a mounted managed route without the blocker', async ({ assert }) => {
    const host = await fixture({ blocker: false })
    try {
      await assert.rejects(() => host.provider.ready(), 'Account Kit blocker middleware is missing')
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('rejects a mounted name absent from registration', async ({ assert }) => {
    const host = await fixture()
    try {
      host.router.get('/rogue', async () => {}).as('accountKit.rogue')
      await assert.rejects(
        () => host.provider.ready(),
        'Account Kit managed route accountKit.rogue is not registered'
      )
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  for (const field of ['method', 'path'] as const)
    test(`rejects a registered route with a changed ${field}`, async ({ assert }) => {
      const host = await fixture()
      try {
        const packagePath = 'adonisjs-account-kit/http'
        const { managedRouteRegistration } = await import(packagePath)
        const registration = managedRouteRegistration(host.router)!
        const route = registration.routes[0] as { method: string; path: string }
        route[field] = field === 'method' ? 'DELETE' : '/wrong'
        await assert.rejects(
          () => host.provider.ready(),
          'Account Kit managed route accountKit.auth.csrf is not registered'
        )
      } finally {
        await host.app.terminate()
      }
    }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('blocks an active actor without requiring masquerade token ability', async ({ assert }) => {
    const host = await fixture()
    try {
      host.router.commit()
      const attempt = await block(host, 'accountKit.auth.passwordReset.request', { active: true })
      try {
        await attempt.call()
        assert.fail('expected active route to block')
      } catch (error) {
        assert.equal((error as { code: string }).code, 'E_MASQUERADE_ACTION_BLOCKED')
        assert.equal((error as { blockedBy: string }).blockedBy, 'sensitive')
        assert.equal((error as { status: number }).status, 403)
      }
      assert.deepEqual(attempt.reads, [
        { namespace: 'users', actorId: '42', actorIncarnation: 'second' },
      ])
      assert.equal(attempt.nextCalls(), 0)
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('passes idle, expired, exempt, unrelated and unauthenticated requests without extra reads', async ({
    assert,
  }) => {
    const host = await fixture()
    try {
      host.router.commit()
      for (const [name, options, expectedReads] of [
        ['accountKit.auth.passwordReset.request', { active: false }, 1],
        ['accountKit.auth.passwordReset.request', { authenticated: false }, 0],
        ['accountKit.account.logout', { active: true }, 0],
        ['accountKit.auth.csrf', { active: true }, 0],
        ['business.route', { active: true }, 0],
      ] as const) {
        const attempt = await block(host, name, options)
        assert.equal(await attempt.call(), 'next')
        assert.equal(attempt.reads.length, expectedReads)
      }
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('maps raw guard and store failures to 503', async ({ assert }) => {
    const host = await fixture()
    try {
      host.router.commit()
      for (const failure of ['guard', 'store'] as const) {
        const attempt = await block(host, 'accountKit.auth.passwordReset.request', { failure })
        try {
          await attempt.call()
          assert.fail('expected unavailable route')
        } catch (error) {
          assert.equal((error as { code: string }).code, 'E_MASQUERADE_UNAVAILABLE')
          assert.equal((error as { status: number }).status, 503)
        }
      }
    } finally {
      await host.app.terminate()
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('rejects missing guard users and unsupported or oversized owner identifiers', async ({
    assert,
  }) => {
    for (const options of [
      { missingUser: true, identifier: 42 },
      { missingUser: false, identifier: { id: 42 } },
      { missingUser: false, identifier: 'x'.repeat(256) },
    ]) {
      const host = await fixture({ identifier: options.identifier })
      try {
        host.router.commit()
        let providerCalls = 0
        const createUserForGuard = host.adapter.provider.createUserForGuard
        host.adapter.provider.createUserForGuard = async (user) => {
          providerCalls++
          return createUserForGuard(user)
        }
        const attempt = await block(host, 'accountKit.auth.passwordReset.request', options)
        await assert.rejects(attempt.call, 'Masquerade is unavailable')
        assert.deepEqual(attempt.reads, [])
        assert.equal(attempt.nextCalls(), 0)
        if (options.missingUser) assert.equal(providerCalls, 0)
      } finally {
        await host.app.terminate()
      }
    }
  }).skip(!canLoadKit(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')
})
