import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { sensitive, allowMutation, routeMarkers } from '../src/integration/route_metadata.ts'
import { selectRouteGuard } from '../src/integration/route_guard_selection.ts'

const middleware = (name: string, args?: unknown[]) => ({ name, args })
const ctx = (routeMiddleware: unknown[] | undefined) => ({
  route: routeMiddleware ? { middleware: { all: () => new Set(routeMiddleware) } } : undefined,
})
const select = (route: ReturnType<typeof ctx>['route'], defaultGuard = 'web_effective') =>
  selectRouteGuard({
    route,
    defaultGuard,
    effectiveRawGuards: { web_effective: 'web' },
    registeredRawGuards: ['web', 'default'],
    primaryRawGuard: 'web',
  })

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

  test('reads the named masquerade marker middleware and ignores other names and options', ({
    assert,
  }) => {
    assert.deepEqual(
      routeMarkers(ctx([middleware('masquerade', [{ marker: 'sensitive' }])]) as never),
      { sensitive: true, allowMutation: false }
    )
    assert.deepEqual(
      routeMarkers(ctx([middleware('masquerade', [{ marker: 'allowMutation' }])]) as never),
      { sensitive: false, allowMutation: true }
    )
    for (const entry of [
      middleware('marker', [{ marker: 'sensitive' }]),
      middleware('masquerade', [{ marker: 'other' }]),
      middleware('masquerade'),
    ])
      assert.deepEqual(routeMarkers(ctx([entry]) as never), {
        sensitive: false,
        allowMutation: false,
      })
  })

  test('reads marker and guard options from a real AdonisJS router route', async ({ assert }) => {
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
      const named = router.named({
        auth: async () => ({ default: AuthMiddleware }),
        masquerade: () => import('../src/route_marker_middleware/main.ts'),
      })
      const route = router
        .get('/real-business-route', async () => {})
        .middleware([named.auth({ guards: ['web_effective'] }), sensitive(), allowMutation()])
        .toJSON()

      const context = { route } as never
      assert.deepEqual(select(route), { kind: 'effective', raw: 'web' })
      assert.deepEqual(routeMarkers(context), { sensitive: true, allowMutation: true })
      const namedRoute = router
        .get('/named-marker-route', async () => {})
        .use(named.masquerade({ marker: 'sensitive' }))
        .toJSON()
      assert.deepEqual(routeMarkers({ route: namedRoute } as never), {
        sensitive: true,
        allowMutation: false,
      })
    } finally {
      await app.terminate()
    }
  })
})
