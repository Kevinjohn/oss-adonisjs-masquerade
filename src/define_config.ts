import type { ControlStore, MasqueradeConfig, RequestControlStore } from './types.js'
import { isBoundedString } from './bounded_string.js'
import { MasqueradeSetupError } from './errors.js'
import type { MasqueradeSetupErrorField } from './errors.js'

/** One hundred years; a longer window has no prunable cutoff on every supported store. */
export const MAX_RETENTION_DAYS = 36_500

/** A configuration whose `authority` and `policy` are present. */
export type CompleteMasqueradeConfig<
  User,
  Request,
  Store extends RequestControlStore = ControlStore,
> = MasqueradeConfig<User, Request, Store> &
  Required<Pick<MasqueradeConfig<User, Request, Store>, 'authority' | 'policy'>>

const fail = (field: MasqueradeSetupErrorField): never => {
  throw new MasqueradeSetupError('E_MASQUERADE_INVALID_CONFIGURATION', field)
}

/** Require the fields `masquerade.callbacks` or the native adapter may supply. */
export function completeConfig<User, Request, Store extends RequestControlStore>(
  config: MasqueradeConfig<User, Request, Store>
): CompleteMasqueradeConfig<User, Request, Store> {
  if (!config.authority) fail('authority')
  if (!config.policy) fail('policy')
  return config as CompleteMasqueradeConfig<User, Request, Store>
}

/**
 * Validate synchronously; resolving the store is deferred to service creation. `authority` and
 * `policy` may be left out when the native adapter and `masquerade.callbacks` supply them.
 */
export function defineConfig<User, Request, Store extends RequestControlStore = ControlStore>(
  config: MasqueradeConfig<User, Request, Store> &
    Required<Pick<MasqueradeConfig<User, Request, Store>, 'authority' | 'policy'>>
): MasqueradeConfig<User, Request, Store> &
  Required<Pick<MasqueradeConfig<User, Request, Store>, 'authority' | 'policy'>>
export function defineConfig<User, Request, Store extends RequestControlStore = ControlStore>(
  config: MasqueradeConfig<User, Request, Store>
): MasqueradeConfig<User, Request, Store>
export function defineConfig<User, Request, Store extends RequestControlStore = ControlStore>(
  config: MasqueradeConfig<User, Request, Store>
): MasqueradeConfig<User, Request, Store> {
  if (
    !config ||
    Object.keys(config).some(
      (key) =>
        ![
          'authority',
          'policy',
          'store',
          'durationSeconds',
          'maxDurationSeconds',
          'contextEnforcement',
          'retention',
          'reason',
        ].includes(key)
    )
  )
    fail('config')
  const { authority, policy } = config
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
  if (policy !== undefined) {
    if (!policy) fail('policy')
    if (typeof policy.canMasquerade !== 'function') fail('policy.canMasquerade')
    if (
      Object.keys(policy).some(
        (key) => !['canMasquerade', 'canEdit', 'canUseRequest'].includes(key)
      )
    )
      fail('policy')
    if (policy.canEdit !== undefined && typeof policy.canEdit !== 'function') fail('policy.canEdit')
    if (policy.canUseRequest !== undefined && typeof policy.canUseRequest !== 'function')
      fail('policy.canUseRequest')
  }
  if (typeof config.store !== 'function') fail('store')
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
    ...(policy && {
      policy: Object.freeze({
        canMasquerade: policy.canMasquerade.bind(policy),
        ...(policy.canEdit ? { canEdit: policy.canEdit.bind(policy) } : {}),
        ...(policy.canUseRequest ? { canUseRequest: policy.canUseRequest.bind(policy) } : {}),
      }),
    }),
    store: config.store.bind(config),
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
