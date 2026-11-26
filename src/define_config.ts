import { configProvider } from '@adonisjs/core'
import type { ApplicationService, ConfigProvider } from '@adonisjs/core/types'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { E_MASQUERADE_INVALID_CONFIGURATION } from './errors.ts'
import type {
  ControlStore,
  MasqueradeConfig,
  MasqueradeConfigOptions,
  RequestControlStore,
} from './types.ts'
import { isBoundedString } from './bounded_string.ts'
import type { MasqueradeSetupErrorField } from './errors.ts'

/** One hundred years; a longer window has no prunable cutoff on every supported store. */
export const MAX_RETENTION_DAYS = 36_500

/** A configuration whose `authority` and `permissions` are present. */
export type CompleteMasqueradeConfig<
  User,
  Request,
  Store extends RequestControlStore = ControlStore,
> = MasqueradeConfig<User, Request, Store> &
  Required<Pick<MasqueradeConfig<User, Request, Store>, 'authority' | 'permissions'>>

const fail = (field: MasqueradeSetupErrorField): never => {
  throw new InvalidArgumentsException(`Invalid masquerade configuration: ${field}`)
}

/** Require the fields `MasqueradeCallbackRegistration` or the native adapter may supply. */
export function completeConfig<User, Request, Store extends RequestControlStore>(
  config: MasqueradeConfig<User, Request, Store>
): CompleteMasqueradeConfig<User, Request, Store> {
  if (!config.authority) throw new E_MASQUERADE_INVALID_CONFIGURATION('authority')
  if (!config.permissions) throw new E_MASQUERADE_INVALID_CONFIGURATION('permissions')
  return config as CompleteMasqueradeConfig<User, Request, Store>
}

/**
 * Validate synchronously and return an AdonisJS config provider. The store receives the booted application. `authority` and
 * `permissions` may be left out when the native adapter and `MasqueradeCallbackRegistration` supply them.
 *
 * @example
 * ```ts
 * import { defineConfig } from '@kevinjohn/adonisjs-masquerade'
 * import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
 * import { Database } from '@adonisjs/lucid/database'
 *
 * export default defineConfig({
 *   store: async (app) => {
 *     const database = await app.container.make(Database)
 *     return new LucidControlStore(database.connection())
 *   },
 *   contextEnforcement: 'enforce',
 *   retention: { days: 30 },
 * })
 * ```
 */
export function defineConfig<User, Request, Store extends RequestControlStore = ControlStore>(
  config: MasqueradeConfigOptions<User, Request, Store>
): ConfigProvider<MasqueradeConfig<User, Request, Store>> {
  const validated = validateConfigFields(config)
  const openStore = config.store.bind(config)
  return configProvider.create(async (app) =>
    Object.freeze({ ...validated, store: () => openStore(app) })
  )
}

/** Resolve the package config after AdonisJS has registered the application services. */
export async function resolveMasqueradeConfig<Request>(app: ApplicationService) {
  const configured = await configProvider.resolve<MasqueradeConfig<unknown, Request>>(
    app,
    app.config.get('masquerade')
  )
  if (!configured)
    throw new InvalidArgumentsException('Invalid masquerade configuration: use defineConfig')
  return configured
}

export function validateConfig<User, Request, Store extends RequestControlStore>(
  config: MasqueradeConfig<User, Request, Store>
): MasqueradeConfig<User, Request, Store> {
  const validated = validateConfigFields(config)
  return Object.freeze({ ...validated, store: config.store.bind(config) })
}

function validateConfigFields<User, Request, Store extends RequestControlStore>(
  config: MasqueradeConfigOptions<User, Request, Store>
): Omit<MasqueradeConfig<User, Request, Store>, 'store'> {
  if (
    !config ||
    Object.keys(config).some(
      (key) =>
        ![
          'authority',
          'permissions',
          'store',
          'durationSeconds',
          'maxDurationSeconds',
          'contextEnforcement',
          'retention',
          'reason',
          'logger',
        ].includes(key)
    )
  )
    fail('config')
  const { authority, permissions } = config
  if (authority !== undefined) {
    if (!authority) fail('authority')
    if (
      Object.keys(authority).some(
        (key) =>
          !['namespace', 'guard', 'incarnation', 'securityStamp', 'inspectAccount'].includes(key)
      )
    )
      fail('authority')
    if (
      !isBoundedString(authority.namespace, 128) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(authority.namespace)
    )
      fail('authority.namespace')
    if (!isBoundedString(authority.guard, 128)) fail('authority.guard')
    if (!(authority.incarnation === 'id' || typeof authority.incarnation === 'function'))
      fail('authority.incarnation')
    if (authority.securityStamp !== undefined && typeof authority.securityStamp !== 'function')
      fail('authority.securityStamp')
    if (typeof authority.inspectAccount !== 'function') fail('authority.inspectAccount')
  }
  if (permissions !== undefined) {
    if (!permissions) fail('permissions')
    if (typeof permissions.canMasquerade !== 'function') fail('permissions.canMasquerade')
    if (
      Object.keys(permissions).some(
        (key) => !['canMasquerade', 'canEdit', 'canUseRequest'].includes(key)
      )
    )
      fail('permissions')
    if (permissions.canEdit !== undefined && typeof permissions.canEdit !== 'function')
      fail('permissions.canEdit')
    if (permissions.canUseRequest !== undefined && typeof permissions.canUseRequest !== 'function')
      fail('permissions.canUseRequest')
  }
  if (typeof config.store !== 'function') fail('store')
  if (
    config.logger !== undefined &&
    (!config.logger ||
      typeof config.logger.info !== 'function' ||
      typeof config.logger.error !== 'function')
  )
    fail('logger')
  const max = config.maxDurationSeconds === undefined ? 3600 : config.maxDurationSeconds
  const duration = config.durationSeconds === undefined ? 900 : config.durationSeconds
  if (!Number.isInteger(max) || max < 60 || max > 3600) fail('maxDurationSeconds')
  if (!Number.isInteger(duration) || duration < 60 || duration > max) fail('durationSeconds')
  if (!['report', 'enforce'].includes(config.contextEnforcement)) fail('contextEnforcement')
  if (config.retention !== 'host-managed' && !config.retention) fail('retention')
  if (
    config.retention !== 'host-managed' &&
    Object.keys(config.retention).some((key) => key !== 'days')
  )
    fail('retention')
  if (
    config.retention !== 'host-managed' &&
    (!Number.isSafeInteger(config.retention.days) ||
      config.retention.days < 1 ||
      config.retention.days > MAX_RETENTION_DAYS)
  )
    fail('retention.days')
  const reason = config.reason === undefined ? 'optional' : config.reason
  if (reason !== 'optional' && reason !== 'required') fail('reason')
  return Object.freeze({
    ...(authority && {
      authority: Object.freeze({
        namespace: authority.namespace,
        guard: authority.guard,
        incarnation:
          typeof authority.incarnation === 'function'
            ? authority.incarnation.bind(authority)
            : authority.incarnation,
        ...(authority.securityStamp
          ? { securityStamp: authority.securityStamp.bind(authority) }
          : {}),
        inspectAccount: authority.inspectAccount.bind(authority),
      }),
    }),
    ...(permissions && {
      permissions: Object.freeze({
        canMasquerade: permissions.canMasquerade.bind(permissions),
        ...(permissions.canEdit ? { canEdit: permissions.canEdit.bind(permissions) } : {}),
        ...(permissions.canUseRequest
          ? { canUseRequest: permissions.canUseRequest.bind(permissions) }
          : {}),
      }),
    }),
    ...(config.logger && { logger: config.logger }),
    contextEnforcement: config.contextEnforcement,
    retention:
      typeof config.retention === 'object'
        ? Object.freeze({ days: config.retention.days })
        : config.retention,
    durationSeconds: duration,
    maxDurationSeconds: max,
    reason,
  })
}
