import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { sensitive, allowMutation, routeMarkers } from '../integration/route_metadata.js'
import { selectRouteGuard } from '../integration/route_guard_selection.js'

const middleware = (name: string, args?: unknown[]) => ({ name, args })
const ctx = (routeMiddleware: unknown[] | undefined) => ({
  route: routeMiddleware ? { middleware: { all: () => new Set(routeMiddleware) } } : undefined,
})
const select = (route: ReturnType<typeof ctx>['route'], defaultGuard = 'web_effective') =>
  selectRouteGuard(route, defaultGuard, { web_effective: 'web' }, ['web', 'default'], 'web')

test.group('masquerade route metadata', () => {
  test('classifies business routes from their matched auth guard metadata', ({ assert }) => {
    assert.deepEqual(select(ctx([middleware('auth', [{ guards: ['web_effective'] }])]).route), {
      kind: 'effective',
      raw: 'web',
    })
    assert.deepEqual(select(ctx([middleware('auth', [{ guards: ['web'] }])]).route), {
      kind: 'raw',
      raw: 'web',
    })
    assert.deepEqual(select(ctx([middleware('auth')]).route), { kind: 'effective', raw: 'web' })
    assert.deepEqual(select(ctx([middleware('auth', [{ guards: ['default'] }])]).route), {
      kind: 'raw',
      raw: 'default',
    })
    assert.deepEqual(select(ctx(undefined).route), { kind: 'none', raw: 'web' })
  })

  test('exposes route and group markers as middleware visible in the matched route', ({
    assert,
  }) => {
    const sensitiveMarker = sensitive()
    const mutationMarker = allowMutation()
    assert.deepEqual(routeMarkers(ctx([sensitiveMarker, mutationMarker]) as never), {
      sensitive: true,
      allowMutation: true,
    })
    assert.deepEqual(routeMarkers(ctx([]) as never), { sensitive: false, allowMutation: false })
  })

  test('reads marker and guard options from a real Adonis router route', async ({ assert }) => {
    class AuthMiddleware {
      async handle(_ctx: unknown, next: () => Promise<unknown>, _options?: { guards: string[] }) {
        await next()
      }
    }
    const app = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .create(new URL('../', import.meta.url))
      .createApp('web')
    await app.init()
    await app.boot()
    try {
      const router = await app.container.make('router')
      const named = router.named({ auth: async () => ({ default: AuthMiddleware }) })
      const route = router
        .get('/real-business-route', async () => {})
        .middleware([named.auth({ guards: ['web_effective'] }), sensitive(), allowMutation()])
        .toJSON()

      const context = { route } as never
      assert.deepEqual(select(route), { kind: 'effective', raw: 'web' })
      assert.deepEqual(routeMarkers(context), { sensitive: true, allowMutation: true })
    } finally {
      await app.terminate()
    }
  })
})
