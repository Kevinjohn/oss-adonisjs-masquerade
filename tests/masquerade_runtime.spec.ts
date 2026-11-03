import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import { MasqueradeSetupError } from '../index.js'
import { nativeRuntimeFixture } from './helpers/native_runtime.js'
import { sqlFixture } from './helpers/sql_store.js'

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
    assert.instanceOf(error, MasqueradeSetupError)
    assert.equal((error as MasqueradeSetupError).code, 'E_MASQUERADE_INVALID_STORE')
    assert.equal((error as MasqueradeSetupError).field, 'store.testOnly')
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
    f.app.container.bindValue('masquerade.native', { ...f.native, authority })
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
  const f = await nativeRuntimeFixture({ store: sql.store })
  let reads = 0
  const read = sql.store.read.bind(sql.store)
  sql.store.read = async (owner) => {
    reads++
    return read(owner)
  }
  const observations: unknown[] = []
  const logs: unknown[][] = []
  f.app.container.bindValue('logger', {
    info: (...args: unknown[]) => {
      logs.push(args)
      return Promise.reject(new Error('private logger failure'))
    },
    error: (...args: unknown[]) => {
      logs.push(args)
    },
  } as never)
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
    assert.include(
      logs.map((args) => args[1]),
      'Masquerade transition'
    )
    assert.include(
      logs.map((args) => args[1]),
      'Masquerade observer failed'
    )
    sql.store.read = async () => {
      throw new Error('private database failure')
    }
    await assert.rejects(() => runtime.service.status(ctx))
    await new Promise((resolve) => setImmediate(resolve))
    assert.include(
      logs.map((args) => args[1]),
      'Masquerade diagnostic'
    )
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
