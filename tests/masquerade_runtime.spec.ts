import { NativeAdapter } from '../src/integration/native_adapter.ts'
import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import { errors, MasqueradeRuntime } from '../index.ts'
import { nativeRuntimeFixture } from './helpers/native_runtime.ts'
import { sqlFixture } from './helpers/sql_store.ts'
import { contextEnforcement } from '../src/integration/context_enforcement.ts'
import { resolveRuntime } from '../src/integration/runtime.ts'

test('configured provider validates native binding and rejects test-only store during boot', async ({
  assert,
}) => {
  const f = await nativeRuntimeFixture()
  try {
    let error: unknown
    try {
      await f.app.boot()
    } catch (caught) {
      error = caught
    }
    assert.instanceOf(error, errors.E_MASQUERADE_INVALID_STORE)
    assert.equal(
      (error as InstanceType<typeof errors.E_MASQUERADE_INVALID_STORE>).code,
      'E_MASQUERADE_INVALID_STORE'
    )
    assert.equal(
      (error as InstanceType<typeof errors.E_MASQUERADE_INVALID_STORE>).field,
      'store.testOnly'
    )
    assert.equal(f.storeCreations(), 1)
  } finally {
    await f.app.terminate()
  }
})

test('provider rejects mismatched native binding before store construction', async ({ assert }) => {
  for (const authority of [
    { namespace: 'other', guard: 'web' },
    { namespace: 'test', guard: 'other' },
  ]) {
    const f = await nativeRuntimeFixture()
    f.app.container.bindValue(NativeAdapter, { ...f.native, authority })
    try {
      await assert.rejects(
        () => f.app.boot(),
        'Native masquerade binding must match configured namespace and guard'
      )
      assert.equal(f.storeCreations(), 0)
    } finally {
      await f.app.terminate()
    }
  }
})

test('provider binds a singleton real runtime and native emitter error handling sees safe committed projection', async ({
  assert,
}) => {
  const sql = await sqlFixture()
  let reads = 0
  const read = sql.store.read.bind(sql.store)
  sql.store.read = async (owner) => {
    reads++
    return read(owner)
  }
  const observations: unknown[] = []
  const logs: unknown[] = []
  const f = await nativeRuntimeFixture({
    store: sql.store,
    logger: {
      info: (event) => {
        logs.push(event)
        return Promise.reject(new Error('private logger failure'))
      },
      error: (event) => logs.push(event),
    },
  })
  try {
    await f.app.boot()
    assert.equal(reads, 0)
    const runtime = await f.app.container.make('masquerade.runtime')
    assert.strictEqual(await f.app.container.make('masquerade.runtime'), runtime)
    assert.equal(runtime.effectiveGuardName, 'web_effective')
    const emitter = await f.app.container.make('emitter')
    const failure = new Error('listener private data')
    emitter.on('masquerade:started', () => {
      throw failure
    })
    emitter.onError((_name, error, data) => {
      assert.strictEqual(error, failure)
      observations.push(data)
    })
    const ctx = new HttpContextFactory().create()
    const auth = await f.app.container.make('auth.manager')
    ctx.auth = auth.createAuthenticator(ctx) as never
    const idle = await runtime.service.status(ctx)
    const active = await runtime.service.start(ctx, {
      targetId: 'b',
      reason: 'private reason',
      expectedContext: idle.contextToken,
    })
    assert.isTrue(active.isMasquerading)
    await new Promise((resolve) => setImmediate(resolve))
    assert.lengthOf(logs, 1)
    assert.equal((logs[0] as { kind: string }).kind, 'started')
    sql.store.read = async () => {
      throw new Error('private database failure')
    }
    await assert.rejects(() => runtime.service.status(ctx))
    await new Promise((resolve) => setImmediate(resolve))
    assert.lengthOf(logs, 2)
    assert.equal((logs[1] as { code: string }).code, 'E_MASQUERADE_UNAVAILABLE')
    assert.lengthOf(observations, 1)
    assert.notInclude(JSON.stringify([observations, logs]), 'private')
    assert.notInclude(JSON.stringify(observations), 'secret-')
  } finally {
    await f.app.terminate()
    await sql.cleanup()
  }
})

test('provider rejects a missing actual raw guard at boot before constructing the store', async ({
  assert,
}) => {
  const f = await nativeRuntimeFixture({ missingRaw: true })
  try {
    await assert.rejects(() => f.app.boot(), 'The configured raw guard must be registered')
    assert.equal(f.storeCreations(), 0)
  } finally {
    await f.app.terminate()
  }
})

test('provider requires the effective session guard to own the default facade', async ({
  assert,
}) => {
  const f = await nativeRuntimeFixture({ rawDefault: true })
  try {
    await assert.rejects(
      () => f.app.boot(),
      'The default auth guard must be an effective masquerade guard'
    )
    assert.equal(f.storeCreations(), 0)
  } finally {
    await f.app.terminate()
  }
})

test('runtime includes every actual effective factory alias with immutable names and shared owner state', async ({
  assert,
}) => {
  const sql = await sqlFixture()
  const f = await nativeRuntimeFixture({ store: sql.store, aliases: true })
  try {
    await f.app.boot()
    const runtime = await f.app.container.make('masquerade.runtime')
    assert.deepEqual(runtime.effectiveGuardNames, ['web_effective', 'support_effective'])
    assert.isTrue(Object.isFrozen(runtime.effectiveGuardNames))
    const auth = await f.app.container.make('auth.manager')
    const control = new HttpContextFactory().create()
    control.auth = auth.createAuthenticator(control) as never
    const idle = await runtime.service.status(control)
    await runtime.service.start(control, {
      targetId: 'b',
      reason: 'case',
      expectedContext: idle.contextToken,
    })
    const business = new HttpContextFactory().create()
    business.route = {
      middleware: { all: () => [{ name: 'auth', args: [{ guards: ['support_effective'] }] }] },
    } as never
    business.auth = auth.createAuthenticator(business) as never
    business.containerResolver.bindValue('masquerade.runtime', runtime)
    contextEnforcement.markContextEnforced(business)
    const defaultGuard = business.auth.use(
      'web_effective' as never
    ) as import('@adonisjs/auth/types').GuardContract<unknown>
    assert.strictEqual(await defaultGuard.authenticate(), f.users.get('b'))
    const guard = business.auth.use(
      'support_effective' as never
    ) as import('@adonisjs/auth/types').GuardContract<unknown>
    assert.strictEqual(await guard.authenticate(), f.users.get('b'))
    const raw = business.auth.use(
      'web' as never
    ) as import('@adonisjs/auth/types').GuardContract<unknown>
    assert.strictEqual(raw.user, f.users.get('a'))
  } finally {
    await f.app.terminate()
    await sql.cleanup()
  }
})

test('the provider registers one runtime available through the request resolver', async ({
  assert,
}) => {
  const sql = await sqlFixture()
  const f = await nativeRuntimeFixture({ store: sql.store })
  try {
    await f.app.boot()
    const runtime = await f.app.container.make('masquerade.runtime')
    assert.isTrue(runtime instanceof MasqueradeRuntime)
    const ctx = new HttpContextFactory().create()
    ctx.containerResolver = f.app.container.createResolver()
    assert.strictEqual(await resolveRuntime(ctx), runtime)

    const fake = { fake: true } as unknown as MasqueradeRuntime
    ctx.containerResolver.bindValue('masquerade.runtime', fake)
    assert.strictEqual(await resolveRuntime(ctx), fake)
    assert.strictEqual(await f.app.container.make('masquerade.runtime'), runtime)
  } finally {
    await f.app.terminate()
    await sql.cleanup()
  }
})

test.group('control route guard check', (group) => {
  // The fixture's memory store is test-only.
  group.each.setup(() => {
    const environment = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    return () => {
      if (environment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = environment
    }
  })
  const limiter = async (_ctx: unknown, next: () => Promise<unknown>) => next()
  const otherLimiter = async (_ctx: unknown, next: () => Promise<unknown>) => next()
  const mount = async (guard: string, unadaptedGuard?: string) => {
    const f = await nativeRuntimeFixture({ unadaptedGuard })
    await f.app.boot()
    const router = await f.app.container.make('router')
    const auth = router.named({
      auth: async () => ({
        default: class {
          async handle(_ctx: unknown, next: () => Promise<unknown>) {
            await next()
          }
        },
      }),
    }).auth
    const runtime = await f.app.container.make('masquerade.runtime')
    runtime.registerRoutes(router, {
      auth,
      guard,
      startLimiter: limiter,
      stopLimiter: otherLimiter,
    })
    return f.app
  }

  test('the provider refuses control routes on an effective guard at ready', async ({ assert }) => {
    const app = await mount('web_effective')
    try {
      await assert.rejects(
        () => app.start(() => {}),
        'registerRoutes guard web_effective is an effective guard; use the raw guard it wraps'
      )
    } finally {
      await app.terminate()
    }
  })

  test('the provider accepts control routes on the raw guard', async ({ assert }) => {
    const app = await mount('web')
    try {
      await app.start(() => {})
      assert.isTrue(app.isReady)
      const runtime = await app.container.make('masquerade.runtime')
      assert.notProperty(runtime, 'controlRouteGuards')
      assert.notInclude(
        Object.getOwnPropertyNames(Object.getPrototypeOf(runtime)),
        'controlRouteGuards'
      )
    } finally {
      await app.terminate()
    }
  })

  test('an unrelated registered raw guard without an adapter does not block readiness', async ({
    assert,
  }) => {
    const app = await mount('web', 'legacy')
    try {
      await app.start(() => {})
      assert.isTrue(app.isReady)
    } finally {
      await app.terminate()
    }
  })

  test('the provider rejects control routes on a registered raw guard without an adapter', async ({
    assert,
  }) => {
    const f = await nativeRuntimeFixture({ unadaptedGuard: 'legacy' })
    try {
      await f.app.boot()
      const router = await f.app.container.make('router')
      const auth = router.named({
        auth: async () => ({
          default: class {
            async handle(_ctx: unknown, next: () => Promise<unknown>) {
              await next()
            }
          },
        }),
      }).auth
      const runtime = await f.app.container.make('masquerade.runtime')
      runtime.registerRoutes(router, {
        auth,
        guard: 'legacy',
        startLimiter: limiter,
        stopLimiter: otherLimiter,
      })
      await assert.rejects(
        () => f.app.start(() => {}),
        'registerRoutes guard legacy has no native adapter'
      )
    } finally {
      await f.app.terminate()
    }
  })
})
