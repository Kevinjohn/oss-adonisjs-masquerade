import { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ApplicationService } from '@adonisjs/core/types'
import { IgnitorFactory } from '@adonisjs/core/factories'
import type { HttpContext, Router } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { test } from '@japa/runner'

type ReadyObservation = {
  environment: string
  committedAtEntry: boolean
  committed: boolean
  managedRoutes: string[]
  registeredRouteCountAtReady?: number
}

type AccountKitHttpApi = {
  registerManagedRoutes(router: Router, options: Record<string, unknown>): readonly unknown[]
  managedRouteRegistration(router: Router): { routes: readonly unknown[] } | undefined
}

async function loadAccountKitHttp(): Promise<AccountKitHttpApi> {
  const source = process.env.ACCOUNT_KIT_SOURCE
  const entry = source
    ? pathToFileURL(resolve(source, 'build/http/main.js')).href
    : '@kevinjohn/adonisjs-account-kit/http'
  return (await import(entry)) as AccountKitHttpApi
}

/** The core app provider writes `.adonisjs/server` under the app root on ready. */
async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'masquerade-account-kit-'))
}

function canResolveAccountKitHttp(): boolean {
  if (process.env.ACCOUNT_KIT_SOURCE) return true
  try {
    import.meta.resolve('@kevinjohn/adonisjs-account-kit/http')
    return true
  } catch {
    return false
  }
}

async function dispatch(
  server: { handle(req: IncomingMessage, res: ServerResponse): unknown },
  url: string
) {
  const request = new IncomingMessage(new Socket())
  request.url = url
  request.method = 'GET'
  request.headers.host = 'localhost'
  const response = new ServerResponse(request)
  let body = ''
  response.end = ((chunk?: string | Buffer) => {
    if (chunk) body += chunk.toString()
    return response
  }) as ServerResponse['end']

  await server.handle(request, response)
  return { status: response.statusCode, body }
}

function readyProbe(
  observations: ReadyObservation[],
  commitRoutes = false,
  registeredRouteCount?: (router: Router) => number
) {
  return class ReadyProbeProvider {
    constructor(private app: ApplicationService) {}

    async ready(): Promise<void> {
      const router = await this.app.container.make('router')
      const committedAtEntry = router.commited
      if (commitRoutes) router.commit()
      observations.push({
        environment: this.app.getEnvironment(),
        committedAtEntry,
        committed: router.commited,
        managedRoutes: (router.toJSON().root ?? [])
          .filter((route) => route.name?.startsWith('accountKit.'))
          .map((route) => route.name!),
        ...(registeredRouteCount
          ? { registeredRouteCountAtReady: registeredRouteCount(router) }
          : {}),
      })
    }
  }
}

function registrationOptions(): Record<string, unknown> {
  return {
    prefix: '/kit',
    kit: async () => ({}),
    guard: {
      strategy: 'session',
      name: 'web',
      forRequest: () => ({}),
      current: async () => ({}),
    },
    enabled: ['passwordReset'],
  }
}

async function hasBlockerOnEveryManagedRoute(router: Router, expected: unknown): Promise<boolean> {
  const managed = (router.toJSON().root ?? []).filter((route) =>
    route.name?.startsWith('accountKit.')
  )
  if (managed.length === 0) return false
  for (const route of managed) {
    let found = false
    for (const item of route.middleware.all()) {
      const reference = (item as { reference?: unknown }).reference ?? item
      if (reference === expected) {
        found = true
        continue
      }
      if (typeof reference !== 'function') continue
      try {
        const loaded = await (reference as () => Promise<{ default?: unknown }>)()
        if (loaded?.default === expected) found = true
      } catch {
        // Unrelated lazy middleware does not establish blocker coverage.
      }
    }
    if (!found) return false
  }
  return true
}

test.group('Account Kit integration lifecycle', () => {
  test('router middleware after initialize_auth intercepts registered public managed routes', async ({
    assert,
  }) => {
    const events: string[] = []
    const root = await temporaryRoot()
    const accountKitHttp = await loadAccountKitHttp()

    class BlockManagedRoutesMiddleware {
      async handle(ctx: HttpContext, next: NextFn): Promise<unknown> {
        events.push(`blocker:${ctx.route?.name}:${Boolean(ctx.auth)}`)
        if (ctx.route?.name?.startsWith('accountKit.'))
          return ctx.response.status(403).send('blocked')
        return next()
      }
    }

    const initializeAuthImport = () => import('@adonisjs/auth/initialize_auth_middleware')
    const blockerImport = async () => ({ default: BlockManagedRoutesMiddleware })
    const readyObservations: ReadyObservation[] = []
    const readyProvider = readyProbe(
      readyObservations,
      false,
      (router) => accountKitHttp.managedRouteRegistration(router)?.routes.length ?? 0
    )
    const app = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .merge({
        rcFileContents: {
          providers: [
            () => import('./helpers/auth_manager_provider.js'),
            async () => ({ default: readyProvider }),
          ],
        },
      })
      .create(pathToFileURL(root + '/'))
      .createApp('web')

    try {
      await app.init()
      await app.boot()
      const router = await app.container.make('router')
      router.use([initializeAuthImport, blockerImport])
      accountKitHttp.registerManagedRoutes(router, registrationOptions())
      const registrationBeforeStart = accountKitHttp.managedRouteRegistration(router)
      assert.exists(registrationBeforeStart, 'registration should be available immediately')
      assert.isAbove(registrationBeforeStart!.routes.length, 0)

      await app.start(async () => {
        const server = await app.container.make('server')
        await server.boot()
      })

      const registered = accountKitHttp.managedRouteRegistration(router)
      assert.exists(registered)
      assert.isAbove(registered!.routes.length, 0)
      assert.deepEqual(readyObservations, [
        {
          environment: 'web',
          committedAtEntry: true,
          committed: true,
          managedRoutes: (router.toJSON().root ?? [])
            .filter((route) => route.name?.startsWith('accountKit.'))
            .map((route) => route.name!),
          registeredRouteCountAtReady: registered!.routes.length,
        },
      ])
      const accountRoutes = (router.toJSON().root ?? []).filter((route) =>
        route.name?.startsWith('accountKit.')
      )
      assert.lengthOf(accountRoutes, registered!.routes.length)

      for (const route of accountRoutes) {
        const middleware = [...route.middleware.all()] as unknown as Array<{
          reference?: unknown
        }>
        const initializeAuthIndex = middleware.findIndex(
          (entry) =>
            typeof entry === 'object' &&
            'reference' in entry &&
            entry.reference === initializeAuthImport
        )
        const blockerIndex = middleware.findIndex(
          (entry) =>
            typeof entry === 'object' && 'reference' in entry && entry.reference === blockerImport
        )
        assert.isAbove(initializeAuthIndex, -1)
        assert.isAbove(blockerIndex, initializeAuthIndex)
      }
      assert.isTrue(await hasBlockerOnEveryManagedRoute(router, BlockManagedRoutesMiddleware))

      const server = await app.container.make('server')
      const result = await dispatch(server, '/kit/auth/password-reset/token')
      assert.equal(result.status, 403)
      assert.equal(result.body, 'blocked')
      assert.deepEqual(events, ['blocker:accountKit.auth.passwordReset.inspect:true'])

      const noBlockerApp = new IgnitorFactory()
        .withCoreProviders()
        .withCoreConfig()
        .create(pathToFileURL(root + '/'))
        .createApp('web')
      try {
        await noBlockerApp.init()
        await noBlockerApp.boot()
        const noBlockerRouter = await noBlockerApp.container.make('router')
        accountKitHttp.registerManagedRoutes(noBlockerRouter, registrationOptions())
        noBlockerRouter.commit()
        assert.isAbove(
          (noBlockerRouter.toJSON().root ?? []).filter((route) =>
            route.name?.startsWith('accountKit.')
          ).length,
          0,
          'the negative control must contain committed managed routes'
        )
        assert.isFalse(
          await hasBlockerOnEveryManagedRoute(noBlockerRouter, BlockManagedRoutesMiddleware)
        )
      } finally {
        await noBlockerApp.terminate()
      }
    } finally {
      await app.terminate()
      await rm(root, { recursive: true, force: true })
    }
  }).skip(!canResolveAccountKitHttp(), 'requires installed Account Kit or ACCOUNT_KIT_SOURCE')

  test('ready sees HTTP routes and can commit console routes before the Ace report command', async ({
    assert,
  }) => {
    const root = await temporaryRoot()
    const httpObservations: ReadyObservation[] = []
    const httpProvider = readyProbe(httpObservations)
    const httpApp = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .merge({
        rcFileContents: {
          providers: [async () => ({ default: httpProvider })],
        },
      })
      .create(pathToFileURL(root + '/'))
      .createApp('web')

    try {
      await httpApp.init()
      await httpApp.boot()
      const router = await httpApp.container.make('router')
      router.get('/http-managed', async () => {}).as('accountKit.auth.login')
      await httpApp.start(async () => {
        const server = await httpApp.container.make('server')
        await server.boot()
      })
      assert.deepEqual(httpObservations, [
        {
          environment: 'web',
          committedAtEntry: true,
          committed: true,
          managedRoutes: ['accountKit.auth.login'],
        },
      ])
    } finally {
      await httpApp.terminate()
      await rm(root, { recursive: true, force: true })
    }

    const aceObservations: ReadyObservation[] = []
    const aceProvider = readyProbe(aceObservations, true)
    let aceRouter: Router | undefined
    const ignitor = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .merge({
        config: { masquerade: { authority: { guard: 'web' } } },
        rcFileContents: {
          commands: [() => import('../commands/main.js')],
          providers: [
            () => import('./helpers/auth_manager_provider.js'),
            async () => ({ default: aceProvider }),
          ],
        },
      })
      .create(new URL('../', import.meta.url))

    await ignitor
      .ace()
      .configure(async (app) => {
        await app.boot()
        aceRouter = await app.container.make('router')
        aceRouter.get('/console-managed', async () => {}).as('accountKit.auth.login')
      })
      .handle(['masquerade:routes'])

    assert.deepEqual(aceObservations, [
      {
        environment: 'console',
        committedAtEntry: false,
        committed: true,
        managedRoutes: ['accountKit.auth.login'],
      },
    ])
    assert.isTrue(aceRouter!.commited)
    assert.include(
      (aceRouter!.toJSON().root ?? []).map((route) => route.name),
      'accountKit.auth.login'
    )
  })
})
