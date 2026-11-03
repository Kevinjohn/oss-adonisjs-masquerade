import { test } from '@japa/runner'
import { RuntimeException } from '@adonisjs/core/exceptions'
import { createMasqueradeService, defineConfig, MasqueradeSetupError } from '../index.js'
import { fixture } from './helpers/core.js'

test('accepts optional canEdit and rejects a non-function as policy.canEdit', ({ assert }) => {
  const f = fixture()
  const config = defineConfig(f.config)
  assert.isFunction(config.policy.canEdit)
  assert.isTrue(Object.isFrozen(config.policy))
  let error: unknown
  try {
    defineConfig({ ...f.config, policy: { ...f.config.policy, canEdit: true } } as never)
  } catch (caught) {
    error = caught
  }
  assert.instanceOf(error, MasqueradeSetupError)
  assert.equal((error as MasqueradeSetupError).field, 'policy.canEdit')
})

test('validates config synchronously and freezes copied configuration', ({ assert }) => {
  const f = fixture()
  const config = defineConfig(f.config)
  assert.equal(config.durationSeconds, 900)
  assert.equal(config.maxDurationSeconds, 3600)
  assert.equal(config.reason, 'optional')
  assert.equal(defineConfig({ ...f.config, reason: 'required' }).reason, 'required')
  assert.isTrue(Object.isFrozen(config))
  assert.isTrue(Object.isFrozen(config.authority))
  assert.isTrue(Object.isFrozen(config.policy))
  f.config.authority.namespace = 'changed'
  assert.equal(config.authority.namespace, 'test')
})

test('invalid service configuration logs a safe diagnostic and preserves startup failure', async ({
  assert,
}) => {
  const f = fixture()
  const invalid = { ...f.config, durationSeconds: 0 } as never
  await assert.rejects(
    () => createMasqueradeService(invalid, f.dependencies),
    'Invalid masquerade configuration'
  )
  assert.deepEqual(f.diagnostics, [
    { category: 'configuration', operation: 'validate', code: 'E_MASQUERADE_INVALID_INPUT' },
  ])
})

for (const [name, patch] of Object.entries({
  unknown: { extra: true },
  policy: { policy: undefined },
  incarnation: { authority: { ...fixture().config.authority, incarnation: undefined } },
  namespace: { authority: { ...fixture().config.authority, namespace: '../bad' } },
  namespaceBound: { authority: { ...fixture().config.authority, namespace: 'x'.repeat(129) } },
  duration: { durationSeconds: Number.NaN },
  infinite: { durationSeconds: Infinity },
  fractional: { durationSeconds: 60.5 },
  small: { durationSeconds: 59 },
  large: { maxDurationSeconds: 3601 },
  narrow: { maxDurationSeconds: 600 },
  retention: { retention: { days: 0 } },
  context: { contextEnforcement: 'ignore' },
  reason: { reason: 'sometimes' },
  unknownPolicy: { policy: { ...fixture().config.policy, onEvent: () => {} } },
  unknownAuthority: { authority: { ...fixture().config.authority, extra: true } },
  unknownRetention: { retention: { days: 7, extra: true } },
}))
  test(`rejects invalid configuration: ${name}`, ({ assert }) => {
    assert.throws(
      () => defineConfig({ ...fixture().config, ...patch } as never),
      'Invalid masquerade configuration'
    )
  })

test('rejects test store outside explicit test environment even when store factory is asynchronous', async ({
  assert,
}) => {
  const f = fixture()
  let error: unknown
  try {
    await createMasqueradeService(f.config, { ...f.dependencies, environment: 'production' })
  } catch (caught) {
    error = caught
  }
  assert.instanceOf(error, MasqueradeSetupError)
  assert.equal((error as MasqueradeSetupError).code, 'E_MASQUERADE_INVALID_STORE')
  assert.equal((error as MasqueradeSetupError).field, 'store.testOnly')
  const narrowed = defineConfig({
    ...f.config,
    durationSeconds: 60,
    maxDurationSeconds: 120,
    retention: { days: 30 },
  })
  assert.equal(narrowed.maxDurationSeconds, 120)
})

test('requires observer and diagnostic ports at service creation', async ({ assert }) => {
  const f = fixture()
  for (const key of ['logger', 'emitter', 'observerErrorHandler']) {
    await assert.rejects(
      () => createMasqueradeService(f.config, { ...f.dependencies, [key]: undefined } as never),
      'Observer and diagnostic ports required'
    )
  }
})

test('explicit null configuration durations are rejected instead of defaulted', ({ assert }) => {
  for (const key of ['durationSeconds', 'maxDurationSeconds']) {
    assert.throws(
      () => defineConfig({ ...fixture().config, [key]: null } as never),
      'Invalid masquerade configuration'
    )
  }
})

test('reports safe, stable field categories for invalid configuration', ({ assert }) => {
  const f = fixture()
  const cases = [
    {
      patch: { authority: { ...f.config.authority, namespace: '../private-secret' } },
      field: 'authority.namespace',
    },
    {
      patch: { policy: { ...f.config.policy, canMasquerade: undefined } },
      field: 'policy.canMasquerade',
    },
    { patch: { durationSeconds: 40 }, field: 'durationSeconds' },
    { patch: { maxDurationSeconds: 4000 }, field: 'maxDurationSeconds' },
    { patch: { retention: { days: 0 } }, field: 'retention.days' },
    { patch: { contextEnforcement: 'ignore' }, field: 'contextEnforcement' },
    { patch: { extra: true }, field: 'config' },
  ] as const

  for (const { patch, field } of cases) {
    let error: unknown
    try {
      defineConfig({ ...f.config, ...patch } as never)
    } catch (caught) {
      error = caught
    }
    assert.instanceOf(error, MasqueradeSetupError)
    assert.instanceOf(error, RuntimeException)
    assert.equal((error as { code?: string }).code, 'E_MASQUERADE_INVALID_CONFIGURATION')
    assert.equal((error as { field?: string }).field, field)
    assert.equal((error as Error).message, 'Invalid masquerade configuration')
    assert.notInclude(JSON.stringify(error), 'private-secret')
  }
})

import type { NativeAuthority, MasqueradePolicy } from '../src/types.js'
import type { Request, User } from './helpers/core.js'

test('preserves inherited contract methods and their class receivers when copying config', async ({
  assert,
}) => {
  const f = fixture()
  class Authority implements NativeAuthority<User> {
    namespace = 'test'
    guard = 'web'
    #users = f.users
    incarnation(user: User): string {
      return this.#users.get(user.id)!.incarnation
    }
    securityStamp(user: User): string {
      return this.#users.get(user.id)!.stamp
    }
    async inspectAccount(id: string) {
      const user = this.#users.get(id)
      return user
        ? {
            subject: { id, incarnation: this.incarnation(user), user },
            active: true,
            securityStamp: this.securityStamp(user),
          }
        : null
    }
  }
  class Policy implements MasqueradePolicy<User, Request> {
    #approved = true
    async canMasquerade(): Promise<boolean> {
      return this.#approved
    }
    async canUseRequest(): Promise<boolean> {
      return this.#approved
    }
  }
  class Configuration {
    authority = new Authority()
    policy = new Policy()
    contextEnforcement = 'enforce' as const
    retention = 'host-managed' as const
    #store = f.store
    async store() {
      return this.#store
    }
  }
  const service = await createMasqueradeService(defineConfig(new Configuration()), f.dependencies)
  const idle = await service.status({})
  const active = await service.start(
    {},
    { targetId: 'b', reason: 'case', expectedContext: idle.contextToken }
  )
  assert.isTrue(active.isMasquerading)
  const resolved = await service.resolve({})
  assert.equal(resolved.effectiveId, 'b')
})
