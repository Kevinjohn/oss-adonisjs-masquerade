import { NativeAdapter } from '../src/integration/native_adapter.ts'
import { test } from '@japa/runner'
import { MasqueradeCallbackRegistration, errors } from '../index.ts'
import { MemoryControlStore } from '../src/testing/main.ts'
import type { ControlStore, MasqueradePermissions } from '../src/types.ts'
import type { User } from './helpers/core.ts'
import { nativeRuntimeFixture } from './helpers/native_runtime.ts'

/** A store the web environment accepts, so boot builds the runtime. */
function hostStore(): ControlStore {
  const memory = new MemoryControlStore()
  return {
    read: memory.read.bind(memory),
    compareAndSet: memory.compareAndSet.bind(memory),
    recordControlOutcome: memory.recordControlOutcome.bind(memory),
  } as unknown as ControlStore
}

function permissions(calls = { count: 0 }): MasqueradePermissions<User, unknown> {
  return {
    canMasquerade: async () => {
      calls.count++
      return true
    },
  }
}

test.group('Masquerade callback registry', () => {
  test('registered callbacks reach the runtime built at boot', async ({ assert }) => {
    const calls = { count: 0 }
    let registry: MasqueradeCallbackRegistration | undefined
    const f = await nativeRuntimeFixture({
      callbacks: true,
      store: hostStore(),
      register: (callbacks, native) => {
        registry = callbacks
        callbacks.register(async () => ({ native, permissions: permissions(calls) }))
      },
    })
    try {
      await f.app.boot()
      assert.instanceOf(registry, MasqueradeCallbackRegistration)
      assert.strictEqual(await f.app.container.make(MasqueradeCallbackRegistration), registry)
      assert.strictEqual(await f.app.container.make(NativeAdapter), f.native)
      const runtime = await f.app.container.make('masquerade.runtime')
      assert.equal(runtime.config.authority.namespace, 'test')
      assert.equal(runtime.config.authority.guard, 'web')
      assert.isTrue(await runtime.config.permissions.canMasquerade({} as never))
      assert.equal(calls.count, 1)
    } finally {
      await f.app.terminate()
    }
  })

  test('a second registration throws', async ({ assert }) => {
    const registry = new MasqueradeCallbackRegistration()
    registry.register(() => ({}))
    assert.throws(
      () => registry.register(() => ({})),
      'Masquerade callbacks are already registered'
    )
  })

  test('a config that passes everything works with nothing registered; later registration throws', async ({
    assert,
  }) => {
    const f = await nativeRuntimeFixture({ store: hostStore() })
    try {
      await f.app.boot()
      assert.strictEqual(await f.app.container.make(NativeAdapter), f.native)
      const runtime = await f.app.container.make('masquerade.runtime')
      assert.equal(runtime.config.authority.namespace, 'test')
      const registry = await f.app.container.make(MasqueradeCallbackRegistration)
      assert.throws(
        () => registry.register(() => ({})),
        'Masquerade callbacks must be registered before masquerade.runtime is first resolved'
      )
    } finally {
      await f.app.terminate()
    }
  })

  test('a field supplied in both places throws naming it', async ({ assert }) => {
    const policyTwice = await nativeRuntimeFixture({
      store: hostStore(),
      register: (registry) => registry.register(() => ({ permissions: permissions() })),
    })
    try {
      await assert.rejects(
        () => policyTwice.app.boot(),
        'Masquerade permissions are supplied by both config/masquerade.ts and MasqueradeCallbackRegistration'
      )
    } finally {
      await policyTwice.app.terminate()
    }
    const nativeTwice = await nativeRuntimeFixture({
      store: hostStore(),
      register: (registry, native) => registry.register(() => ({ native: { ...native } })),
    })
    try {
      await assert.rejects(
        () => nativeTwice.app.boot(),
        'Masquerade native is supplied by both NativeAdapter and MasqueradeCallbackRegistration'
      )
    } finally {
      await nativeTwice.app.terminate()
    }
  })

  test('a required field missing from both places throws the configuration error', async ({
    assert,
  }) => {
    const noPolicy = await nativeRuntimeFixture({
      callbacks: true,
      store: hostStore(),
      register: (registry, native) => registry.register(() => ({ native })),
    })
    try {
      const error = await noPolicy.app.boot().catch((caught: unknown) => caught)
      assert.instanceOf(error, errors.E_MASQUERADE_INVALID_CONFIGURATION)
      assert.equal(
        (error as InstanceType<typeof errors.E_MASQUERADE_INVALID_CONFIGURATION>).code,
        'E_MASQUERADE_INVALID_CONFIGURATION'
      )
      assert.equal(
        (error as InstanceType<typeof errors.E_MASQUERADE_INVALID_CONFIGURATION>).field,
        'permissions'
      )
    } finally {
      await noPolicy.app.terminate()
    }
    const noNative = await nativeRuntimeFixture({ callbacks: true, store: hostStore() })
    try {
      await assert.rejects(
        () => noNative.app.boot(),
        'Masquerade needs a native adapter: bind NativeAdapter or register one through MasqueradeCallbackRegistration'
      )
    } finally {
      await noNative.app.terminate()
    }
  })
})
