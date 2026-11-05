import type { MasqueradeConfig } from './types.js'
import { boundedString } from './bounded_string.js'
import { MasqueradeSetupError } from './errors.js'
import type { MasqueradeSetupErrorField } from './errors.js'

/** One hundred years; a longer window has no prunable cutoff on every supported store. */
export const MAX_RETENTION_DAYS = 36_500

/** Validate synchronously; resolving the store is deferred to service creation. */
export function defineConfig<User, Request>(
  config: MasqueradeConfig<User, Request>
): MasqueradeConfig<User, Request> {
  const fail = (field: MasqueradeSetupErrorField): never => {
    throw new MasqueradeSetupError('E_MASQUERADE_INVALID_CONFIGURATION', field)
  }
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
  const authority = config.authority
  if (!authority) fail('authority')
  if (
    Object.keys(authority).some(
      (key) =>
        !['namespace', 'guard', 'incarnation', 'securityStamp', 'inspectAccount'].includes(key)
    )
  )
    fail('authority')
  if (
    !boundedString(authority.namespace, 128) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(authority.namespace)
  )
    fail('authority.namespace')
  if (!boundedString(authority.guard, 128)) fail('authority.guard')
  if (!(authority.incarnation === 'id' || typeof authority.incarnation === 'function'))
    fail('authority.incarnation')
  if (typeof authority.securityStamp !== 'function') fail('authority.securityStamp')
  if (typeof authority.inspectAccount !== 'function') fail('authority.inspectAccount')

  if (!config.policy) fail('policy')
  if (typeof config.policy.canMasquerade !== 'function') fail('policy.canMasquerade')
  if (
    Object.keys(config.policy).some(
      (key) => !['canMasquerade', 'canEdit', 'canUseRequest'].includes(key)
    )
  )
    fail('policy')
  if (config.policy.canEdit !== undefined && typeof config.policy.canEdit !== 'function')
    fail('policy.canEdit')
  if (
    config.policy.canUseRequest !== undefined &&
    typeof config.policy.canUseRequest !== 'function'
  )
    fail('policy.canUseRequest')
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
    authority: Object.freeze({
      namespace: authority.namespace,
      guard: authority.guard,
      incarnation:
        typeof authority.incarnation === 'function'
          ? authority.incarnation.bind(authority)
          : authority.incarnation,
      securityStamp: authority.securityStamp.bind(authority),
      inspectAccount: authority.inspectAccount.bind(authority),
    }),
    policy: Object.freeze({
      canMasquerade: config.policy.canMasquerade.bind(config.policy),
      ...(config.policy.canEdit ? { canEdit: config.policy.canEdit.bind(config.policy) } : {}),
      ...(config.policy.canUseRequest
        ? { canUseRequest: config.policy.canUseRequest.bind(config.policy) }
        : {}),
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
