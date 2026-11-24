import { RuntimeException } from '@adonisjs/core/exceptions'
import { MasqueradeRequestException } from './request_exception.js'
import type { PrunePhase, PruneResult } from './prune.js'
import type { StopPhase } from './stop_modes.js'

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
  | 'authority'
  | 'authority.namespace'
  | 'authority.guard'
  | 'authority.incarnation'
  | 'authority.securityStamp'
  | 'authority.inspectAccount'
  | 'policy'
  | 'policy.canMasquerade'
  | 'policy.canEdit'
  | 'policy.canUseRequest'
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

class UnauthenticatedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_UNAUTHENTICATED'
  static status = 401
  static message = 'Actor authentication required'
}

class NotAllowedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_NOT_ALLOWED'
  static status = 403
  static message = 'Masquerade is not allowed'
}

class ActionBlockedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACTION_BLOCKED'
  static status = 403
  static message = 'Action is blocked while masquerading'

  constructor(readonly blockedBy: MasqueradeBlockedBy) {
    super()
  }

  /** @internal */
  protected override responseDetails() {
    return { blockedBy: this.blockedBy }
  }
}

class AlreadyActiveException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ALREADY_ACTIVE'
  static status = 409
  static message = 'Masquerade is already active'
}

class ContextChangedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_CONTEXT_CHANGED'
  static status = 409
  static message = 'Masquerade context changed'
}

class InvalidInputException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_INVALID_INPUT'
  static status = 422
  static message = 'Invalid masquerade input'
}

class ContextRequiredException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_CONTEXT_REQUIRED'
  static status = 428
  static message = 'Masquerade context required'
}

class UnavailableException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_UNAVAILABLE'
  static status = 503
  static message = 'Masquerade is unavailable'
}

class InvalidConfigurationException extends RuntimeException {
  static code = 'E_MASQUERADE_INVALID_CONFIGURATION'
  static status = 500
  static message = 'Invalid masquerade configuration'

  constructor(readonly field: MasqueradeSetupErrorField) {
    super()
  }
}

class InvalidStoreException extends RuntimeException {
  static code = 'E_MASQUERADE_INVALID_STORE'
  static status = 500
  static message = 'Invalid masquerade store for environment'

  constructor(readonly field: MasqueradeSetupErrorField) {
    super()
  }
}

// These failures retain the unavailable response while carrying distinct recovery information.
class UnknownCommitException extends UnavailableException {}

class StopProgressException extends UnavailableException {
  constructor(
    readonly phase: StopPhase,
    readonly stopped: number,
    override readonly cause: unknown
  ) {
    super()
  }

  get indeterminate(): boolean {
    return this.phase === 'stop_commit' && this.cause instanceof E_MASQUERADE_UNKNOWN_COMMIT
  }
}

class PruneProgressException extends UnavailableException {
  constructor(
    readonly phase: PrunePhase,
    readonly completed: PruneResult,
    readonly indeterminate: boolean = false
  ) {
    super()
  }
}

/**
 * Actor authentication required.
 * @class
 */
export const E_MASQUERADE_UNAUTHENTICATED = UnauthenticatedException

/**
 * Masquerade is not allowed.
 * @class
 */
export const E_MASQUERADE_NOT_ALLOWED = NotAllowedException

/**
 * Action is blocked while masquerading.
 * @class
 */
export const E_MASQUERADE_ACTION_BLOCKED = ActionBlockedException

/**
 * Masquerade is already active.
 * @class
 */
export const E_MASQUERADE_ALREADY_ACTIVE = AlreadyActiveException

/**
 * Masquerade context changed.
 * @class
 */
export const E_MASQUERADE_CONTEXT_CHANGED = ContextChangedException

/**
 * Invalid masquerade input.
 * @class
 */
export const E_MASQUERADE_INVALID_INPUT = InvalidInputException

/**
 * Masquerade context required.
 * @class
 */
export const E_MASQUERADE_CONTEXT_REQUIRED = ContextRequiredException

/**
 * Masquerade is unavailable.
 * @class
 */
export const E_MASQUERADE_UNAVAILABLE = UnavailableException

/**
 * Invalid masquerade configuration.
 * @class
 */
export const E_MASQUERADE_INVALID_CONFIGURATION = InvalidConfigurationException

/**
 * Invalid masquerade store for environment.
 * @class
 */
export const E_MASQUERADE_INVALID_STORE = InvalidStoreException

/**
 * A transition whose commit could not be confirmed. Its response is `E_MASQUERADE_UNAVAILABLE`.
 * @class
 */
export const E_MASQUERADE_UNKNOWN_COMMIT = UnknownCommitException

/**
 * Progress confirmed before a bulk stop failed. Its code is `E_MASQUERADE_UNAVAILABLE`.
 * @class
 */
export const E_MASQUERADE_STOP_PROGRESS = StopProgressException

/**
 * Counts confirmed before prune failed. Its code is `E_MASQUERADE_UNAVAILABLE`.
 * @class
 */
export const E_MASQUERADE_PRUNE_PROGRESS = PruneProgressException
