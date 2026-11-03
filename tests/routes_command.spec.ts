import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { routeCoverageReport } from '../commands/routes.js'
import { sensitive } from '../src/integration/route_metadata.js'

test.group('masquerade:routes Ace command', () => {
  test('reports routes from the actual router grouped by guard and marker', async ({ assert }) => {
    class AuthMiddleware {
      async handle(_ctx: unknown, next: () => Promise<unknown>, _options?: { guards: string[] }) {
        await next()
      }
    }
    const app = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .merge({
        config: { masquerade: { authority: { guard: 'web' } } },
        rcFileContents: {
          commands: [() => import('../commands/main.js')],
          providers: [() => import('./helpers/auth_manager_provider.js')],
        },
      })
      .create(new URL('../', import.meta.url))
      .createApp('web')
    await app.init()
    await app.boot()
    try {
      const router = await app.container.make('router')
      const auth = router.named({ auth: async () => ({ default: AuthMiddleware }) })
      const route = router
        .get('/admin/accounts', async () => {})
        .middleware([auth.auth({ guards: ['web'] }), sensitive()])
        .toJSON()
      assert.deepEqual(
        [...route.middleware.all()]
          .filter((entry) => typeof entry === 'object')
          .map((entry) => ({
            name: (entry as { name?: string }).name,
            args: (entry as { args?: unknown }).args,
          })),
        [{ name: 'auth', args: { guards: ['web'] } }]
      )
      const packageControl = router
        .post('/masquerade/start', [
          () =>
            import('../http/controllers.js').then(({ MasqueradeController }) => ({
              default: MasqueradeController,
            })),
          'start',
        ])
        .middleware(auth.auth({ guards: ['web'] }))
        .toJSON()
      const controllerModule = await import('../http/controllers.js')
      class BusinessController {
        async start() {}
      }
      const reexportDoesNotProveControl = router
        .post('/business/start', [
          async () => ({
            default: BusinessController,
            MasqueradeController: controllerModule.MasqueradeController,
          }),
          'start',
        ])
        .middleware(auth.auth({ guards: ['web'] }))
        .toJSON()
      const misleadingHostName = router
        .post('/admin/logout/export', async () => {})
        .as('admin.logout.export')
        .middleware(auth.auth({ guards: ['web'] }))
        .toJSON()
      const exactHostNameCollision = router
        .post('/reports/export', async () => {})
        .as('logout')
        .middleware(auth.auth({ guards: ['web'] }))
        .toJSON()
      const unresolvedStringController = router
        .post('/legacy/masquerade/start', 'MasqueradeController.start')
        .middleware(auth.auth({ guards: ['web'] }))
        .toJSON()
      const implicitDefault = router
        .get('/implicit-default', async () => {})
        .middleware(auth.auth())
        .toJSON()
      const explicitDefault = router
        .get('/explicit-default', async () => {})
        .middleware(auth.auth({ guards: ['default'] }))
        .toJSON()
      const mixedEffectiveFirst = router
        .get('/mixed-effective-first', async () => {})
        .middleware(auth.auth({ guards: ['web_effective', 'web'] }))
        .toJSON()
      const mixedRawFirst = router
        .get('/mixed-raw-first', async () => {})
        .middleware(auth.auth({ guards: ['web', 'web_effective'] }))
        .toJSON()
      const allEffectiveAliases = router
        .get('/all-effective-aliases', async () => {})
        .middleware(auth.auth({ guards: ['web_effective', 'support_effective'] }))
        .toJSON()
      const mixedEffectiveTransports = router
        .get('/mixed-effective-transports', async () => {})
        .middleware(auth.auth({ guards: ['web_effective', 'api_effective'] }))
        .toJSON()
      const sections = await routeCoverageReport(
        {
          root: [
            route,
            packageControl,
            reexportDoesNotProveControl,
            misleadingHostName,
            exactHostNameCollision,
            unresolvedStringController,
            implicitDefault,
            explicitDefault,
            mixedEffectiveFirst,
            mixedRawFirst,
            allEffectiveAliases,
            mixedEffectiveTransports,
          ],
        },
        'web',
        'web_effective',
        ['web_effective', 'support_effective', 'api_effective'],
        { web_effective: 'web', support_effective: 'web', api_effective: 'api' }
      )
      const report = sections.join('\n')
      assert.include(report, 'web\n')
      assert.include(report, 'GET')
      assert.include(report, '/admin/accounts')
      assert.include(report, 'sensitive')
      assert.include(report, 'RAW-GUARD BUSINESS')
      assert.include(report, '/masquerade/start [CONTROL MUTATION]')
      assert.include(report, '/business/start [RAW-GUARD BUSINESS MUTATION]')
      assert.include(
        report,
        '/reports/export [POSSIBLE CONTROL MUTATION] (name-inferred; review handler)'
      )
      assert.include(report, '/admin/logout/export [RAW-GUARD BUSINESS MUTATION]')
      assert.include(report, '/legacy/masquerade/start [RAW-GUARD BUSINESS MUTATION]')
      assert.include(report, 'unresolved handler')
      assert.include(report, 'web_effective\n')
      assert.include(report, '/implicit-default')
      assert.include(report, 'default\n')
      assert.include(report, '/explicit-default')
      assert.match(
        report,
        /\/mixed-effective-first.*unsupported mixed effective\/non-effective guards/
      )
      assert.match(report, /\/mixed-raw-first.*unsupported mixed effective\/non-effective guards/)
      assert.include(report, '/all-effective-aliases')
      assert.match(
        report,
        /\/mixed-effective-transports.*unsupported distinct effective credential transports/
      )
      assert.notMatch(
        report,
        /\/all-effective-aliases.*unsupported distinct effective credential transports/
      )
      assert.equal(report.match(/unsupported mixed effective\/non-effective guards/g)?.length, 4)
      assert.match(report, /default\n[\s\S]*\/explicit-default/)
      assert.include(report, '/explicit-default [RAW-GUARD BUSINESS READ]')
    } finally {
      await app.terminate()
    }
  })

  test('is discoverable by the package Ace loader', async ({ assert }) => {
    const commands = await import('../commands/main.js')
    const metadata = await commands.getMetaData()
    const reportMetadata = metadata.find((entry) => entry.commandName === 'masquerade:routes')
    assert.exists(reportMetadata)
    const command = await commands.getCommand(reportMetadata!)
    assert.equal(command?.commandName, 'masquerade:routes')
  })

  test('runs through Ace and commits registered routes before reporting them', async ({
    assert,
  }) => {
    const ignitor = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .merge({
        config: { masquerade: { authority: { guard: 'web' } } },
        rcFileContents: {
          commands: [() => import('../commands/main.js')],
          providers: [() => import('./helpers/auth_manager_provider.js')],
        },
      })
      .create(new URL('../', import.meta.url))
    let registeredRoutes!: () => string[]
    await ignitor
      .ace()
      .configure(async (app) => {
        await app.boot()
        const router = await app.container.make('router')
        router.get('/ace-coverage-probe', async () => {})
        registeredRoutes = () =>
          Object.values(router.toJSON())
            .flat()
            .map((route) => route.pattern)
      })
      .handle(['masquerade:routes'])
    assert.include(registeredRoutes(), '/ace-coverage-probe')
  })
})
