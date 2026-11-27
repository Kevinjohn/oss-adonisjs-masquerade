import { configProvider } from '@adonisjs/core'
import { validateConfig } from '../src/define_config.ts'
import { test } from '@japa/runner'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { createMasqueradeService, defineConfig, errors } from '../index.ts'
import { fixture } from './helpers/core.ts'

test('accepts optional canEdit and rejects a non-function as permissions.canEdit', async ({
  assert,
}) => {
  const f = fixture()
  const config = await defineConfig(f.config).resolver({} as never)
  assert.isFunction(config.permissions?.canEdit)
  assert.isTrue(Object.isFrozen(config.permissions))
  let error: unknown
  try {
    defineConfig({ ...f.config, permissions: { ...f.config.permissions, canEdit: true } } as never)
  } catch (caught) {
    error = caught
  }
  assert.instanceOf(error, InvalidArgumentsException)
  assert.equal((error as Error).message, 'Invalid masquerade configuration: permissions.canEdit')
})

test('rejects an authority with a securityStamp method', ({ assert }) => {
  const f = fixture()
  const authority = { ...f.config.authority, securityStamp: () => 'stamp' }
  assert.throws(
    () => defineConfig({ ...f.config, authority } as never),
    'Invalid masquerade configuration: authority'
  )
})

test('validates config synchronously and freezes copied configuration', async ({ assert }) => {
  const f = fixture()
  const config = await defineConfig(f.config).resolver({} as never)
  assert.equal(config.durationSeconds, 900)
  assert.equal(config.maxDurationSeconds, 3600)
  assert.equal(config.reason, 'optional')
  const required = await defineConfig({ ...f.config, reason: 'required' }).resolver({} as never)
  assert.equal(required.reason, 'required')
  assert.isTrue(Object.isFrozen(config))
  assert.isTrue(Object.isFrozen(config.authority))
  assert.isTrue(Object.isFrozen(config.permissions))
  f.config.authority.namespace = 'changed'
  assert.equal(config.authority?.namespace, 'test')
})

test('invalid service configuration logs a safe diagnostic and preserves startup failure', async ({
  assert,
}) => {
  const f = fixture()
  const invalid = { ...f.config, durationSeconds: 0 } as never
  const error = await createMasqueradeService(invalid, f.dependencies).catch(
    (caught: unknown) => caught
  )
  assert.instanceOf(error, InvalidArgumentsException)
  assert.equal((error as Error).message, 'Invalid masquerade configuration: durationSeconds')
  assert.deepEqual(f.diagnostics, [
    { category: 'configuration', operation: 'validate', code: 'E_MASQUERADE_UNAVAILABLE' },
  ])
})

for (const [name, patch] of Object.entries({
  unknown: { extra: true },
  permissions: { permissions: null },
  authority: { authority: null },
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
  retentionBound: { retention: { days: 36_501 } },
  context: { contextEnforcement: 'ignore' },
  reason: { reason: 'sometimes' },
  unknownPolicy: { permissions: { ...fixture().config.permissions, onEvent: () => {} } },
  unknownAuthority: { authority: { ...fixture().config.authority, extra: true } },
  unknownRetention: { retention: { days: 7, extra: true } },
}))
  test(`rejects invalid configuration: ${name}`, ({ assert }) => {
    assert.throws(
      () => defineConfig({ ...fixture().config, ...patch } as never),
      'Invalid masquerade configuration'
    )
  })

test('accepts a config without authority and permissions; the service still requires them', async ({
  assert,
}) => {
  const f = fixture()
  const { authority, permissions, ...plain } = f.config
  const config = await defineConfig(plain).resolver({} as never)
  assert.notProperty(config, 'authority')
  assert.notProperty(config, 'permissions')
  for (const [missing, field] of [
    [{ ...plain, permissions }, 'authority'],
    [{ ...plain, authority }, 'permissions'],
  ] as const) {
    const error = await createMasqueradeService(missing, f.dependencies).catch(
      (caught: unknown) => caught
    )
    assert.instanceOf(error, errors.E_MASQUERADE_INVALID_CONFIGURATION)
    assert.equal(
      (error as InstanceType<typeof errors.E_MASQUERADE_INVALID_CONFIGURATION>).field,
      field
    )
  }
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
  assert.instanceOf(error, errors.E_MASQUERADE_INVALID_STORE)
  assert.equal(
    (error as InstanceType<typeof errors.E_MASQUERADE_INVALID_STORE>).code,
    'E_MASQUERADE_INVALID_STORE'
  )
  assert.equal(
    (error as InstanceType<typeof errors.E_MASQUERADE_INVALID_STORE>).field,
    'store.testOnly'
  )
  const narrowed = await defineConfig({
    ...f.config,
    durationSeconds: 60,
    maxDurationSeconds: 120,
    retention: { days: 30 },
  }).resolver({} as never)
  assert.equal(narrowed.maxDurationSeconds, 120)
})

test('validates required service ports before opening the store', async ({ assert }) => {
  const f = fixture()
  let openCount = 0
  const config = {
    ...f.config,
    store: async () => {
      openCount++
      return f.store
    },
  }
  const observerError = 'Observer and diagnostic ports required'
  const cases = [
    [{ authenticateActor: undefined }, 'Actor authentication resolver required'],
    [{ emitter: { emit: undefined } }, observerError],
    [{ logger: { ...f.dependencies.logger, info: undefined } }, observerError],
    [{ logger: { ...f.dependencies.logger, error: undefined } }, observerError],
    [{ observerErrorHandler: undefined }, observerError],
  ] as const
  for (const [patch, message] of cases) {
    const error = await createMasqueradeService(config, {
      ...f.dependencies,
      ...patch,
    } as never).catch((caught: unknown) => caught)
    assert.instanceOf(error, InvalidArgumentsException)
    assert.equal((error as Error).message, message)
    assert.equal(openCount, 0)
  }
  await createMasqueradeService(config, f.dependencies)
  assert.equal(openCount, 1)
  assert.deepEqual(f.diagnostics, [])
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
      patch: { permissions: { ...f.config.permissions, canMasquerade: undefined } },
      field: 'permissions.canMasquerade',
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
    assert.instanceOf(error, InvalidArgumentsException)
    assert.equal((error as Error).message, `Invalid masquerade configuration: ${field}`)
    assert.notInclude(JSON.stringify(error), 'private-secret')
  }
})

import type { NativeAuthority, MasqueradePermissions } from '../src/types.ts'
import type { Request, User } from './helpers/core.ts'

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
  class Policy implements MasqueradePermissions<User, Request> {
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
    permissions = new Policy()
    contextEnforcement = 'enforce' as const
    retention = 'host-managed' as const
    #store = f.store
    async store() {
      return this.#store
    }
  }
  const service = await createMasqueradeService(validateConfig(new Configuration()), f.dependencies)
  const idle = await service.status({})
  const active = await service.start(
    {},
    { targetId: 'b', reason: 'case', expectedContext: idle.contextToken }
  )
  assert.isTrue(active.isMasquerading)
  const resolved = await service.resolve({})
  assert.equal(resolved.effectiveId, 'b')
})

test('accepts a retention window of one hundred years', ({ assert }) => {
  assert.doesNotThrow(() => defineConfig({ ...fixture().config, retention: { days: 36_500 } }))
})

test('passes AdonisJS application to the store only when requested', async ({ assert }) => {
  const f = fixture()
  const app = {} as never
  const calls: unknown[] = []
  const provider = defineConfig({
    ...f.config,
    store: async (application) => {
      calls.push(application)
      return f.store
    },
  })
  const config = await configProvider.resolve<typeof f.config>(app, provider)
  assert.isNotNull(config)
  assert.deepEqual(calls, [])
  assert.equal(await config!.store(), f.store)
  assert.deepEqual(calls, [app])
})
