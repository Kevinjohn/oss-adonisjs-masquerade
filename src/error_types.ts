/** Stable request error codes; each maps to one HTTP status and English message. */
export type MasqueradeErrorCode =
  | 'E_MASQUERADE_UNAUTHENTICATED'
  | 'E_MASQUERADE_NOT_ALLOWED'
  | 'E_MASQUERADE_ACTION_BLOCKED'
  | 'E_MASQUERADE_ALREADY_ACTIVE'
  | 'E_MASQUERADE_CONTEXT_CHANGED'
  | 'E_MASQUERADE_INVALID_INPUT'
  | 'E_MASQUERADE_CONTEXT_REQUIRED'
  | 'E_MASQUERADE_UNAVAILABLE'

/** The route rule behind `E_MASQUERADE_ACTION_BLOCKED`. */
export type MasqueradeBlockedBy = 'sensitive' | 'view_only' | 'mutation_not_allowed'

/** Stable boot-time configuration error codes. */
export type MasqueradeSetupErrorCode =
  'E_MASQUERADE_INVALID_CONFIGURATION' | 'E_MASQUERADE_INVALID_STORE'

/** The configuration field named by a setup exception. */
export type MasqueradeSetupErrorField =
  | 'config'
  | 'logger'
  | 'authority'
  | 'authority.namespace'
  | 'authority.guard'
  | 'authority.incarnation'
  | 'authority.securityStamp'
  | 'authority.inspectAccount'
  | 'permissions'
  | 'permissions.canMasquerade'
  | 'permissions.canEdit'
  | 'permissions.canUseRequest'
  | 'store'
  | 'store.testOnly'
  | 'store.read'
  | 'store.compareAndSet'
  | 'store.recordControlOutcome'
  | 'store.expiredBatch'
  | 'store.activeBatch'
  | 'store.pruneEvents'
  | 'durationSeconds'
  | 'maxDurationSeconds'
  | 'reason'
  | 'contextEnforcement'
  | 'retention'
  | 'retention.days'
