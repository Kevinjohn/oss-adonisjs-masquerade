import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import type { Router } from '@adonisjs/core/http'
import { routeCoverageReport } from '../commands/routes.js'
import { masqueradeRoutes } from '../http/control_routes.js'
import { MasqueradeController } from '../http/controllers.js'
import { selectRouteGuard } from '../integration/route_guard_selection.js'
import { MasqueradeError } from '../src/errors.js'
import { fixture } from './helpers/core.js'
import { requestContext } from './helpers/http_context.js'

class AuthMiddleware {
  async handle(_ctx: unknown, next: () => Promise<unknown>, _options?: { guards: string[] }) {
    await next()
  }
}

async function withRouter(run: (router: Router) => Promise<void>): Promise<void> {
  const app = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .create(new URL('../', import.meta.url))
    .createApp('web')
  await app.init()
  await app.boot()
  try {
    await run(await app.container.make('router'))
  } finally {
    await app.terminate()
  }
}

function namedAuth(router: Router) {
  return router.named({ auth: async () => ({ default: AuthMiddleware }) }).auth
}

const startLimiter = async (_ctx: unknown, next: () => Promise<unknown>) => next()
const stopLimiter = async (_ctx: unknown, next: () => Promise<unknown>) => next()

test.group('masqueradeRoutes', () => {
  test('mounts the package controls behind the raw guard and separate limiters', async ({
    assert,
  }) => {
    await withRouter(async (router) => {
      masqueradeRoutes(router, { auth: namedAuth(router), guard: 'web', startLimiter, stopLimiter })
      router.commit()
      const routes = router.toJSON().root
      assert.deepEqual(
        routes.map((route) => [route.methods.join(','), route.pattern, route.name]),
        [
          ['GET,HEAD', '/masquerade', 'masquerade.status'],
          ['POST', '/masquerade/start', 'masquerade.start'],
          ['POST', '/masquerade/stop', 'masquerade.stop'],
        ]
      )
      const middleware = routes.map((route) => [...route.middleware.all()])
      assert.isFalse(middleware[0].includes(startLimiter) || middleware[0].includes(stopLimiter))
      assert.isTrue(middleware[1].includes(startLimiter))
      assert.isFalse(middleware[1].includes(stopLimiter))
      assert.isTrue(middleware[2].includes(stopLimiter))
      assert.isFalse(middleware[2].includes(startLimiter))
      for (const route of routes)
        assert.deepEqual((route.handler as { reference?: unknown }).reference, [
          MasqueradeController,
          (route.handler as { method: string }).method,
        ])
      assert.deepEqual(await routeCoverageReport(router.toJSON(), 'web', 'web_effective'), [
        [
          'web',
          '  GET,HEAD           /masquerade [CONTROL READ]',
          '  POST               /masquerade/start [CONTROL MUTATION]',
          '  POST               /masquerade/stop [CONTROL MUTATION]',
        ].join('\n'),
      ])
    })
  })

  test('takes a path and name prefix for another raw guard', async ({ assert }) => {
    await withRouter(async (router) => {
      const group = masqueradeRoutes(router, {
        auth: namedAuth(router),
        guard: 'api',
        startLimiter,
        stopLimiter,
        prefix: '/api/masquerade',
        as: 'token.masquerade',
      })
      group.use(startLimiter)
      router.commit()
      assert.deepEqual(
        router.toJSON().root.map((route) => [route.pattern, route.name]),
        [
          ['/api/masquerade', 'token.masquerade.status'],
          ['/api/masquerade/start', 'token.masquerade.start'],
          ['/api/masquerade/stop', 'token.masquerade.stop'],
        ]
      )
      const [report] = await routeCoverageReport(router.toJSON(), 'web', 'web_effective')
      assert.include(report, 'api\n  GET,HEAD           /api/masquerade [CONTROL READ]')
    })
  })

  test('flags effective-guard controls and still permits stopping through the raw mount', async ({
    assert,
  }) => {
    await withRouter(async (router) => {
      masqueradeRoutes(router, {
        auth: namedAuth(router),
        guard: 'web_effective',
        startLimiter,
        stopLimiter,
        prefix: '/effective/masquerade',
        as: 'effective.masquerade',
      })
      masqueradeRoutes(router, { auth: namedAuth(router), guard: 'web', startLimiter, stopLimiter })
      router.commit()

      const routes = router.toJSON().root
      const effectiveStatus = routes.find((route) => route.name === 'effective.masquerade.status')!
      const rawStop = routes.find((route) => route.name === 'masquerade.stop')!
      const sections = await routeCoverageReport(
        router.toJSON(),
        'web',
        'web_effective',
        ['web_effective'],
        { web_effective: 'web' }
      )
      const report = sections.join('\n')
      assert.include(
        report,
        '/effective/masquerade [CONTROL READ] (effective guard; controls must use raw guard)'
      )

      const f = fixture()
      const service = await f.create()
      const active = await f.start(service)
      const authenticationCount = f.state.authenticateCount
      const authSelection = (route: typeof effectiveStatus) =>
        selectRouteGuard(route, 'web_effective', { web_effective: 'web' }, ['web'], 'web')

      const effectiveRequest = requestContext(f, {
        method: 'GET',
        route: effectiveStatus,
        selectGuard: () => authSelection(effectiveStatus),
      })
      let failure: unknown
      try {
        await new MasqueradeController().status(effectiveRequest.ctx)
      } catch (error) {
        failure = error
      }
      assert.instanceOf(failure, MasqueradeError)
      assert.equal((failure as MasqueradeError).code, 'E_MASQUERADE_UNAVAILABLE')
      assert.equal(f.state.authenticateCount, authenticationCount)
      const stillActive = await service.status({ actorId: 'a' })
      assert.isTrue(stillActive.isMasquerading)

      const rawRequest = requestContext(f, {
        method: 'POST',
        body: {},
        raw: '{}',
        header: active.contextToken,
        route: rawStop,
        selectGuard: () => authSelection(rawStop),
      })
      await new MasqueradeController().stop(rawRequest.ctx)
      assert.equal(rawRequest.responseState.status, 200)
      assert.isFalse((rawRequest.responseState.json as { isMasquerading: boolean }).isMasquerading)
    })
  })

  test('fails at registration without the raw guard, auth or both limiters', async ({ assert }) => {
    await withRouter(async (router) => {
      const auth = namedAuth(router)
      const valid = { auth, guard: 'web', startLimiter, stopLimiter }
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ ...valid, guard: undefined }, 'requires the raw guard name'],
        [{ ...valid, guard: '' }, 'requires the raw guard name'],
        [{ ...valid, auth: undefined }, 'requires the host auth middleware'],
        [{ ...valid, startLimiter: undefined }, 'requires a start limiter and a stop limiter'],
        [{ ...valid, stopLimiter: undefined }, 'requires a start limiter and a stop limiter'],
        [{ ...valid, stopLimiter: startLimiter }, 'requires separate start and stop limiters'],
        [{ ...valid, prefix: 'masquerade' }, 'prefix must start with /'],
        [{ ...valid, auth: () => startLimiter }, 'auth must be the named auth middleware'],
        [{ ...valid, auth: () => auth({ guards: ['web_effective'] }) }, 'named auth middleware'],
        [{ ...valid, auth: () => auth() }, 'named auth middleware'],
      ]
      for (const [options, message] of cases)
        assert.throws(
          () =>
            masqueradeRoutes(router, options as unknown as Parameters<typeof masqueradeRoutes>[1]),
          message
        )
      router.commit()
      assert.deepEqual(router.toJSON().root ?? [], [])
    })
  })
})
