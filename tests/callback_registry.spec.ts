import { test } from '@japa/runner'
import { MasqueradeCallbackRegistry, MasqueradeSetupError } from '../index.js'
import { MemoryControlStore } from '../testing/main.js'
import type { ControlStore, MasqueradePolicy } from '../src/types.js'
import type { User } from './helpers/core.js'
import { nativeRuntimeFixture } from './helpers/native_runtime.js'

/** A store the web environment accepts, so boot builds the runtime. */
function hostStore(): ControlStore {
  const memory = new MemoryControlStore()
  return {
    read: memory.read.bind(memory),
    compareAndSet: memory.compareAndSet.bind(memory),
    recordControlOutcome: memory.recordControlOutcome.bind(memory),
  } as unknown as ControlStore
}

function policy(calls = { count: 0 }): MasqueradePolicy<User, unknown> {
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
    let registry: MasqueradeCallbackRegistry | undefined
    const f = await nativeRuntimeFixture({
      callbacks: true,
      store: hostStore(),
      register: (callbacks, native) => {
        registry = callbacks
        callbacks.register(async () => ({ native, policy: policy(calls) }))
      },
    })
    try {
      await f.app.boot()
      assert.instanceOf(registry, MasqueradeCallbackRegistry)
      assert.strictEqual(await f.app.container.make(MasqueradeCallbackRegistry), registry)
      assert.strictEqual(await f.app.container.make('masquerade.native'), f.native)
      const runtime = await f.app.container.make('masquerade.runtime')
      assert.equal(runtime.config.authority.namespace, 'test')
      assert.equal(runtime.config.authority.guard, 'web')
      assert.isTrue(await runtime.config.policy.canMasquerade({} as never))
      assert.equal(calls.count, 1)
    } finally {
      await f.app.terminate()
    }
  })

  test('a second registration throws', async ({ assert }) => {
    const registry = new MasqueradeCallbackRegistry()
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
      assert.strictEqual(await f.app.container.make('masquerade.native'), f.native)
      const runtime = await f.app.container.make('masquerade.runtime')
      assert.equal(runtime.config.authority.namespace, 'test')
      const registry = await f.app.container.make('masquerade.callbacks')
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
      register: (registry) => registry.register(() => ({ policy: policy() })),
    })
    try {
      await assert.rejects(
        () => policyTwice.app.boot(),
        'Masquerade policy is supplied by both config/masquerade.ts and masquerade.callbacks'
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
        'Masquerade native is supplied by both masquerade.native and masquerade.callbacks'
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
      assert.instanceOf(error, MasqueradeSetupError)
      assert.equal((error as MasqueradeSetupError).code, 'E_MASQUERADE_INVALID_CONFIGURATION')
      assert.equal((error as MasqueradeSetupError).field, 'policy')
    } finally {
      await noPolicy.app.terminate()
    }
    const noNative = await nativeRuntimeFixture({ callbacks: true, store: hostStore() })
    try {
      await assert.rejects(
        () => noNative.app.boot(),
        'Masquerade needs a native adapter: bind masquerade.native or register one through masquerade.callbacks'
      )
    } finally {
      await noNative.app.terminate()
    }
  })
})
