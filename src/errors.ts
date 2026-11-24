import { RuntimeException } from '@adonisjs/core/exceptions'
import {
  EligibilityException,
  GuardWiringException,
  MasqueradeRequestException,
} from './request_exception.js'
import type { PrunePhase, PruneResult } from './prune.js'
import type { ControlStore } from './types.js'
import type { StopPhase } from './stop_modes.js'

/** Stable request exception codes exposed to server callers. */
export type MasqueradeErrorCode = Exclude<
  keyof typeof import('./errors.js'),
  MasqueradeSetupErrorCode
>

/** Codes that can appear in the HTTP response. */
export type MasqueradeResponseCode =
  MasqueradeErrorCode | 'E_MASQUERADE_NOT_ALLOWED' | 'E_MASQUERADE_UNAVAILABLE'

/** The route rule reported by a blocked action. */
export type MasqueradeBlockedBy = 'sensitive' | 'view_only' | 'mutation_not_allowed'

/** Stable boot-time configuration error codes. */
export type MasqueradeSetupErrorCode =
  | 'E_MASQUERADE_INVALID_CONFIGURATION'
  | 'E_MASQUERADE_STORE_MISSING'
  | 'E_MASQUERADE_TEST_STORE_FORBIDDEN'
  | 'E_MASQUERADE_STORE_METHOD_MISSING'

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
  static code = 'E_MASQUERADE_UNAUTHENTICATED' as const
  static status = 401
  static message = 'Actor authentication required'

  constructor() {
    super()
  }
}

class AlreadyActiveException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ALREADY_ACTIVE' as const
  static status = 409
  static message = 'Masquerade is already active'

  constructor() {
    super()
  }
}

class ContextChangedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_CONTEXT_CHANGED' as const
  static status = 409
  static message = 'Masquerade context changed'

  constructor() {
    super()
  }
}

class InvalidInputException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_INVALID_INPUT' as const
  static status = 422
  static message = 'Invalid masquerade input'

  constructor() {
    super()
  }
}

class ContextRequiredException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_CONTEXT_REQUIRED' as const
  static status = 428
  static message = 'Masquerade context required'

  constructor() {
    super()
  }
}

class InvalidConfigurationException extends RuntimeException {
  static code = 'E_MASQUERADE_INVALID_CONFIGURATION' as const
  static status = 500
  static message = 'Invalid masquerade configuration'

  constructor(readonly field: MasqueradeSetupErrorField) {
    super()
  }
}

class UnknownCommitException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_UNKNOWN_COMMIT' as const
  static status = 503
  static message = 'The masquerade transition could not be confirmed'

  constructor() {
    super()
  }
}

class StopProgressException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_STOP_PROGRESS' as const
  static status = 503
  static message = 'Bulk stop could not complete'

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

class PruneProgressException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_PRUNE_PROGRESS' as const
  static status = 503
  static message = 'Prune could not complete'

  constructor(
    readonly phase: PrunePhase,
    readonly completed: PruneResult,
    readonly indeterminate: boolean = false,
    cause?: unknown
  ) {
    super(cause)
  }
}

/**
 * Actor authentication required.
 * @class
 */
export const E_MASQUERADE_UNAUTHENTICATED = UnauthenticatedException

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
 * Invalid masquerade configuration.
 * @class
 */
export const E_MASQUERADE_INVALID_CONFIGURATION = InvalidConfigurationException

/**
 * A transition whose commit could not be confirmed.
 * @class
 */
export const E_MASQUERADE_UNKNOWN_COMMIT = UnknownCommitException

/**
 * Progress confirmed before a bulk stop failed.
 * @class
 */
export const E_MASQUERADE_STOP_PROGRESS = StopProgressException

/**
 * Counts confirmed before prune failed.
 * @class
 */
export const E_MASQUERADE_PRUNE_PROGRESS = PruneProgressException

class RouteAuthGuardMissingException extends GuardWiringException {
  static code = 'E_MASQUERADE_ROUTE_AUTH_GUARD_MISSING' as const
  static status = 503
  static message = 'The route auth middleware selects no guard'

  constructor() {
    super()
  }
}

/**
 * The route auth middleware selects no guard.
 * @class
 */
export const E_MASQUERADE_ROUTE_AUTH_GUARD_MISSING = RouteAuthGuardMissingException

class PrimaryGuardMissingException extends GuardWiringException {
  static code = 'E_MASQUERADE_PRIMARY_GUARD_MISSING' as const
  static status = 503
  static message = 'The primary masquerade guard is missing'

  constructor() {
    super()
  }
}

/**
 * The primary masquerade guard is missing.
 * @class
 */
export const E_MASQUERADE_PRIMARY_GUARD_MISSING = PrimaryGuardMissingException

class RouteGuardUnregisteredException extends GuardWiringException {
  static code = 'E_MASQUERADE_ROUTE_GUARD_UNREGISTERED' as const
  static status = 503
  static message = 'The route selects an unregistered guard'

  constructor() {
    super()
  }
}

/**
 * The route selects an unregistered guard.
 * @class
 */
export const E_MASQUERADE_ROUTE_GUARD_UNREGISTERED = RouteGuardUnregisteredException

class RouteGuardConflictException extends GuardWiringException {
  static code = 'E_MASQUERADE_ROUTE_GUARD_CONFLICT' as const
  static status = 503
  static message = 'The route selects incompatible effective guards'

  constructor() {
    super()
  }
}

/**
 * The route selects incompatible effective guards.
 * @class
 */
export const E_MASQUERADE_ROUTE_GUARD_CONFLICT = RouteGuardConflictException

class RouteGuardAmbiguousException extends GuardWiringException {
  static code = 'E_MASQUERADE_ROUTE_GUARD_AMBIGUOUS' as const
  static status = 503
  static message = 'The route selects more than one native guard'

  constructor() {
    super()
  }
}

/**
 * The route selects more than one native guard.
 * @class
 */
export const E_MASQUERADE_ROUTE_GUARD_AMBIGUOUS = RouteGuardAmbiguousException

class NativeAdapterMissingException extends GuardWiringException {
  static code = 'E_MASQUERADE_NATIVE_ADAPTER_MISSING' as const
  static status = 503
  static message = 'The route has no native masquerade adapter'

  constructor() {
    super()
  }
}

/**
 * The route has no native masquerade adapter.
 * @class
 */
export const E_MASQUERADE_NATIVE_ADAPTER_MISSING = NativeAdapterMissingException

class EffectiveDriverMissingException extends GuardWiringException {
  static code = 'E_MASQUERADE_EFFECTIVE_DRIVER_MISSING' as const
  static status = 503
  static message = 'The effective guard has no registered driver'

  constructor() {
    super()
  }
}

/**
 * The effective guard has no registered driver.
 * @class
 */
export const E_MASQUERADE_EFFECTIVE_DRIVER_MISSING = EffectiveDriverMissingException

class GuardConstructionFailedException extends GuardWiringException {
  static code = 'E_MASQUERADE_GUARD_CONSTRUCTION_FAILED' as const
  static status = 503
  static message = 'The guard could not be constructed'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The guard could not be constructed.
 * @class
 */
export const E_MASQUERADE_GUARD_CONSTRUCTION_FAILED = GuardConstructionFailedException

class GuardDriverMismatchException extends GuardWiringException {
  static code = 'E_MASQUERADE_GUARD_DRIVER_MISMATCH' as const
  static status = 503
  static message = 'The guard uses an unexpected driver'

  constructor() {
    super()
  }
}

/**
 * The guard uses an unexpected driver.
 * @class
 */
export const E_MASQUERADE_GUARD_DRIVER_MISMATCH = GuardDriverMismatchException

class ControlGuardRequiredException extends GuardWiringException {
  static code = 'E_MASQUERADE_CONTROL_GUARD_REQUIRED' as const
  static status = 503
  static message = 'The control route must use a raw guard'

  constructor() {
    super()
  }
}

/**
 * The control route must use a raw guard.
 * @class
 */
export const E_MASQUERADE_CONTROL_GUARD_REQUIRED = ControlGuardRequiredException

class ContextMiddlewareMissingException extends GuardWiringException {
  static code = 'E_MASQUERADE_CONTEXT_MIDDLEWARE_MISSING' as const
  static status = 503
  static message = 'The request did not run the context middleware'

  constructor() {
    super()
  }
}

/**
 * The request did not run the context middleware.
 * @class
 */
export const E_MASQUERADE_CONTEXT_MIDDLEWARE_MISSING = ContextMiddlewareMissingException

class InvalidLucidStoreException extends GuardWiringException {
  static code = 'E_MASQUERADE_INVALID_LUCID_STORE' as const
  static status = 503
  static message = 'The Lucid control store configuration is invalid'

  constructor() {
    super()
  }
}

/**
 * The Lucid control store configuration is invalid.
 * @class
 */
export const E_MASQUERADE_INVALID_LUCID_STORE = InvalidLucidStoreException

class BlockerAdapterUnavailableException extends GuardWiringException {
  static code = 'E_MASQUERADE_BLOCKER_ADAPTER_UNAVAILABLE' as const
  static status = 503
  static message = 'The Account Kit blocker could not resolve its adapter'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The Account Kit blocker could not resolve its adapter.
 * @class
 */
export const E_MASQUERADE_BLOCKER_ADAPTER_UNAVAILABLE = BlockerAdapterUnavailableException

class StartDeniedException extends EligibilityException {
  static code = 'E_MASQUERADE_START_DENIED' as const
  static status = 403
  static message = 'The start policy declined masquerade'

  constructor() {
    super()
  }
}

/**
 * The start policy declined masquerade.
 * @class
 */
export const E_MASQUERADE_START_DENIED = StartDeniedException

class EditDeniedException extends EligibilityException {
  static code = 'E_MASQUERADE_EDIT_DENIED' as const
  static status = 403
  static message = 'The edit policy declined edit access'

  constructor() {
    super()
  }
}

/**
 * The edit policy declined edit access.
 * @class
 */
export const E_MASQUERADE_EDIT_DENIED = EditDeniedException

class RequestDeniedException extends EligibilityException {
  static code = 'E_MASQUERADE_REQUEST_DENIED' as const
  static status = 403
  static message = 'The request policy declined this request'

  constructor() {
    super()
  }
}

/**
 * The request policy declined this request.
 * @class
 */
export const E_MASQUERADE_REQUEST_DENIED = RequestDeniedException

class TokenAbilityRequiredException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_TOKEN_ABILITY_REQUIRED' as const
  static status = 403
  static message = 'The token lacks the ability required to control masquerade'

  constructor() {
    super()
  }
}

/**
 * The token lacks the ability required to control masquerade.
 * @class
 */
export const E_MASQUERADE_TOKEN_ABILITY_REQUIRED = TokenAbilityRequiredException

class OperatorActorNotFoundException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_OPERATOR_ACTOR_NOT_FOUND' as const
  static status = 422
  static message = 'No current account was found for the operator'

  constructor() {
    super()
  }
}

/**
 * No current account was found for the operator.
 * @class
 */
export const E_MASQUERADE_OPERATOR_ACTOR_NOT_FOUND = OperatorActorNotFoundException

class OperatorInputInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_OPERATOR_INPUT_INVALID' as const
  static status = 422
  static message = 'An operator option is invalid'

  constructor() {
    super()
  }
}

/**
 * An operator option is invalid.
 * @class
 */
export const E_MASQUERADE_OPERATOR_INPUT_INVALID = OperatorInputInvalidException

class StoreOpenFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_STORE_OPEN_FAILED' as const
  static status = 503
  static message = 'The masquerade store could not be opened'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The masquerade store could not be opened.
 * @class
 */
export const E_MASQUERADE_STORE_OPEN_FAILED = StoreOpenFailedException

class StoreReadFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_STORE_READ_FAILED' as const
  static status = 503
  static message = 'The masquerade store could not read a mode'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The masquerade store could not read a mode.
 * @class
 */
export const E_MASQUERADE_STORE_READ_FAILED = StoreReadFailedException

class StoreBatchFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_STORE_BATCH_FAILED' as const
  static status = 503
  static message = 'The masquerade store could not read a batch'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The masquerade store could not read a batch.
 * @class
 */
export const E_MASQUERADE_STORE_BATCH_FAILED = StoreBatchFailedException

class StoreCommitFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_STORE_COMMIT_FAILED' as const
  static status = 503
  static message = 'The masquerade store could not commit the mode transition'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The masquerade store could not commit the mode transition.
 * @class
 */
export const E_MASQUERADE_STORE_COMMIT_FAILED = StoreCommitFailedException

class AuditWriteFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_AUDIT_WRITE_FAILED' as const
  static status = 503
  static message = 'The masquerade audit outcome could not be recorded'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The masquerade audit outcome could not be recorded.
 * @class
 */
export const E_MASQUERADE_AUDIT_WRITE_FAILED = AuditWriteFailedException

class AccountInspectionFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACCOUNT_INSPECTION_FAILED' as const
  static status = 503
  static message = 'The account authority could not inspect an account'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The account authority could not inspect an account.
 * @class
 */
export const E_MASQUERADE_ACCOUNT_INSPECTION_FAILED = AccountInspectionFailedException

class ActorAuthenticationFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACTOR_AUTHENTICATION_FAILED' as const
  static status = 503
  static message = 'The native guard could not authenticate the actor'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The native guard could not authenticate the actor.
 * @class
 */
export const E_MASQUERADE_ACTOR_AUTHENTICATION_FAILED = ActorAuthenticationFailedException

class ActorIdentityFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACTOR_IDENTITY_FAILED' as const
  static status = 503
  static message = 'The actor identity could not be resolved'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The actor identity could not be resolved.
 * @class
 */
export const E_MASQUERADE_ACTOR_IDENTITY_FAILED = ActorIdentityFailedException

class BlockerAuthenticationFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_BLOCKER_AUTHENTICATION_FAILED' as const
  static status = 503
  static message = 'The Account Kit blocker could not check the actor'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The Account Kit blocker could not check the actor.
 * @class
 */
export const E_MASQUERADE_BLOCKER_AUTHENTICATION_FAILED = BlockerAuthenticationFailedException

class BlockerModeCheckFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_BLOCKER_MODE_CHECK_FAILED' as const
  static status = 503
  static message = 'The Account Kit blocker could not check the active mode'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The Account Kit blocker could not check the active mode.
 * @class
 */
export const E_MASQUERADE_BLOCKER_MODE_CHECK_FAILED = BlockerModeCheckFailedException

class TokenAbilityCheckFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_TOKEN_ABILITY_CHECK_FAILED' as const
  static status = 503
  static message = 'The token ability could not be checked'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The token ability could not be checked.
 * @class
 */
export const E_MASQUERADE_TOKEN_ABILITY_CHECK_FAILED = TokenAbilityCheckFailedException

class ManagedCredentialCheckFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_MANAGED_CREDENTIAL_CHECK_FAILED' as const
  static status = 503
  static message = 'The Account Kit credential could not be checked'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The Account Kit credential could not be checked.
 * @class
 */
export const E_MASQUERADE_MANAGED_CREDENTIAL_CHECK_FAILED = ManagedCredentialCheckFailedException

class StartPolicyFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_START_POLICY_FAILED' as const
  static status = 503
  static message = 'The start policy could not be evaluated'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The start policy could not be evaluated.
 * @class
 */
export const E_MASQUERADE_START_POLICY_FAILED = StartPolicyFailedException

class EditPolicyFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_EDIT_POLICY_FAILED' as const
  static status = 503
  static message = 'The edit policy could not be evaluated'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The edit policy could not be evaluated.
 * @class
 */
export const E_MASQUERADE_EDIT_POLICY_FAILED = EditPolicyFailedException

class RequestPolicyFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_REQUEST_POLICY_FAILED' as const
  static status = 503
  static message = 'The request policy could not be evaluated'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The request policy could not be evaluated.
 * @class
 */
export const E_MASQUERADE_REQUEST_POLICY_FAILED = RequestPolicyFailedException

class ControlOperationFailedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_CONTROL_OPERATION_FAILED' as const
  static status = 503
  static message = 'The masquerade control operation could not be completed'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The masquerade control operation could not be completed.
 * @class
 */
export const E_MASQUERADE_CONTROL_OPERATION_FAILED = ControlOperationFailedException

class ClockInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_CLOCK_INVALID' as const
  static status = 503
  static message = 'The masquerade clock did not return a supported instant'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The masquerade clock did not return a supported instant.
 * @class
 */
export const E_MASQUERADE_CLOCK_INVALID = ClockInvalidException

class ModeRowInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_MODE_ROW_INVALID' as const
  static status = 503
  static message = 'The masquerade store returned an invalid mode row'

  constructor() {
    super()
  }
}

/**
 * The masquerade store returned an invalid mode row.
 * @class
 */
export const E_MASQUERADE_MODE_ROW_INVALID = ModeRowInvalidException

class StoreBatchInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_STORE_BATCH_INVALID' as const
  static status = 503
  static message = 'The masquerade store returned an invalid batch'

  constructor() {
    super()
  }
}

/**
 * The masquerade store returned an invalid batch.
 * @class
 */
export const E_MASQUERADE_STORE_BATCH_INVALID = StoreBatchInvalidException

class StoreRetiredException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_STORE_RETIRED' as const
  static status = 503
  static message = 'The masquerade store is unavailable after a cleanup failure'

  constructor() {
    super()
  }
}

/**
 * The masquerade store is unavailable after a cleanup failure.
 * @class
 */
export const E_MASQUERADE_STORE_RETIRED = StoreRetiredException

class TransitionInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_TRANSITION_INVALID' as const
  static status = 503
  static message = 'The mode transition and its audit event are inconsistent'

  constructor() {
    super()
  }
}

/**
 * The mode transition and its audit event are inconsistent.
 * @class
 */
export const E_MASQUERADE_TRANSITION_INVALID = TransitionInvalidException

class AuditOutcomeInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_AUDIT_OUTCOME_INVALID' as const
  static status = 503
  static message = 'The control outcome event is invalid'

  constructor() {
    super()
  }
}

/**
 * The control outcome event is invalid.
 * @class
 */
export const E_MASQUERADE_AUDIT_OUTCOME_INVALID = AuditOutcomeInvalidException

class ActorSubjectInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACTOR_SUBJECT_INVALID' as const
  static status = 503
  static message = 'The account authority returned an invalid subject'

  constructor(cause?: unknown) {
    super(cause)
  }
}

/**
 * The account authority returned an invalid subject.
 * @class
 */
export const E_MASQUERADE_ACTOR_SUBJECT_INVALID = ActorSubjectInvalidException

class AccountIdInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACCOUNT_ID_INVALID' as const
  static status = 503
  static message = 'The account provider returned an invalid identifier'

  constructor() {
    super()
  }
}

/**
 * The account provider returned an invalid identifier.
 * @class
 */
export const E_MASQUERADE_ACCOUNT_ID_INVALID = AccountIdInvalidException

class AccountIncarnationInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACCOUNT_INCARNATION_INVALID' as const
  static status = 503
  static message = 'The account provider returned an invalid incarnation'

  constructor() {
    super()
  }
}

/**
 * The account provider returned an invalid incarnation.
 * @class
 */
export const E_MASQUERADE_ACCOUNT_INCARNATION_INVALID = AccountIncarnationInvalidException

class AccountOwnerMismatchException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACCOUNT_OWNER_MISMATCH' as const
  static status = 503
  static message = 'The account identifiers do not agree'

  constructor() {
    super()
  }
}

/**
 * The account identifiers do not agree.
 * @class
 */
export const E_MASQUERADE_ACCOUNT_OWNER_MISMATCH = AccountOwnerMismatchException

class AccountUserInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACCOUNT_USER_INVALID' as const
  static status = 503
  static message = 'The account provider did not supply a user'

  constructor() {
    super()
  }
}

/**
 * The account provider did not supply a user.
 * @class
 */
export const E_MASQUERADE_ACCOUNT_USER_INVALID = AccountUserInvalidException

class AccountEligibilityInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_ACCOUNT_ELIGIBILITY_INVALID' as const
  static status = 503
  static message = 'The account authority returned an invalid eligibility value'

  constructor() {
    super()
  }
}

/**
 * The account authority returned an invalid eligibility value.
 * @class
 */
export const E_MASQUERADE_ACCOUNT_ELIGIBILITY_INVALID = AccountEligibilityInvalidException

class SecurityStampInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_SECURITY_STAMP_INVALID' as const
  static status = 503
  static message = 'The account authority returned an invalid security stamp'

  constructor() {
    super()
  }
}

/**
 * The account authority returned an invalid security stamp.
 * @class
 */
export const E_MASQUERADE_SECURITY_STAMP_INVALID = SecurityStampInvalidException

class ModeOwnerInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_MODE_OWNER_INVALID' as const
  static status = 503
  static message = 'The mode owner is invalid'

  constructor() {
    super()
  }
}

/**
 * The mode owner is invalid.
 * @class
 */
export const E_MASQUERADE_MODE_OWNER_INVALID = ModeOwnerInvalidException

class RevisionExhaustedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_REVISION_EXHAUSTED' as const
  static status = 503
  static message = 'The mode revision cannot be advanced'

  constructor() {
    super()
  }
}

/**
 * The mode revision cannot be advanced.
 * @class
 */
export const E_MASQUERADE_REVISION_EXHAUSTED = RevisionExhaustedException

class StopConflictException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_STOP_CONFLICT' as const
  static status = 503
  static message = 'The mode changed while the operator was trying to stop it'

  constructor() {
    super()
  }
}

/**
 * The mode changed while the operator was trying to stop it.
 * @class
 */
export const E_MASQUERADE_STOP_CONFLICT = StopConflictException

class RetentionCutoffInvalidException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_RETENTION_CUTOFF_INVALID' as const
  static status = 503
  static message = 'The audit retention cutoff is outside the supported range'

  constructor() {
    super()
  }
}

/**
 * The audit retention cutoff is outside the supported range.
 * @class
 */
export const E_MASQUERADE_RETENTION_CUTOFF_INVALID = RetentionCutoffInvalidException

class TransitionConflictException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_TRANSITION_CONFLICT' as const
  static status = 409
  static message = 'The mode changed before the transition could be applied'

  constructor() {
    super()
  }
}

/**
 * The mode changed before the transition could be applied.
 * @class
 */
export const E_MASQUERADE_TRANSITION_CONFLICT = TransitionConflictException

class ModeExpiredException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_MODE_EXPIRED' as const
  static status = 409
  static message = 'The active masquerade mode expired'

  constructor() {
    super()
  }
}

/**
 * The active masquerade mode expired.
 * @class
 */
export const E_MASQUERADE_MODE_EXPIRED = ModeExpiredException

class ModeInvalidatedException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_MODE_INVALIDATED' as const
  static status = 409
  static message = 'The active masquerade mode was invalidated'

  constructor() {
    super()
  }
}

/**
 * The active masquerade mode was invalidated.
 * @class
 */
export const E_MASQUERADE_MODE_INVALIDATED = ModeInvalidatedException

abstract class BlockedActionException<
  Reason extends MasqueradeBlockedBy,
> extends MasqueradeRequestException {
  abstract readonly blockedBy: Reason

  /** @internal */
  protected override responseDetails() {
    return { blockedBy: this.blockedBy }
  }
}

class SensitiveActionBlockedException extends BlockedActionException<'sensitive'> {
  static code = 'E_MASQUERADE_SENSITIVE_ACTION_BLOCKED' as const
  static status = 403
  static message = 'Action is blocked while masquerading'
  readonly blockedBy = 'sensitive' as const

  constructor() {
    super()
  }
}

/**
 * Action is blocked while masquerading.
 * @class
 */
export const E_MASQUERADE_SENSITIVE_ACTION_BLOCKED = SensitiveActionBlockedException

class ViewOnlyActionBlockedException extends BlockedActionException<'view_only'> {
  static code = 'E_MASQUERADE_VIEW_ONLY_ACTION_BLOCKED' as const
  static status = 403
  static message = 'Action is blocked while masquerading'
  readonly blockedBy = 'view_only' as const

  constructor() {
    super()
  }
}

/**
 * Action is blocked while masquerading.
 * @class
 */
export const E_MASQUERADE_VIEW_ONLY_ACTION_BLOCKED = ViewOnlyActionBlockedException

class UnmarkedMutationBlockedException extends BlockedActionException<'mutation_not_allowed'> {
  static code = 'E_MASQUERADE_UNMARKED_MUTATION_BLOCKED' as const
  static status = 403
  static message = 'Action is blocked while masquerading'
  readonly blockedBy = 'mutation_not_allowed' as const

  constructor() {
    super()
  }
}

/**
 * Action is blocked while masquerading.
 * @class
 */
export const E_MASQUERADE_UNMARKED_MUTATION_BLOCKED = UnmarkedMutationBlockedException

class ActorMissingException extends EligibilityException {
  static code = 'E_MASQUERADE_ACTOR_MISSING' as const
  static status = 403
  static message = 'The authority did not return the authenticated actor'

  constructor() {
    super()
  }
}

/**
 * The authority did not return the authenticated actor.
 * @class
 */
export const E_MASQUERADE_ACTOR_MISSING = ActorMissingException

class ActorInactiveException extends EligibilityException {
  static code = 'E_MASQUERADE_ACTOR_INACTIVE' as const
  static status = 403
  static message = 'The authenticated actor is inactive'

  constructor() {
    super()
  }
}

/**
 * The authenticated actor is inactive.
 * @class
 */
export const E_MASQUERADE_ACTOR_INACTIVE = ActorInactiveException

class ActorIdentityMismatchException extends EligibilityException {
  static code = 'E_MASQUERADE_ACTOR_IDENTITY_MISMATCH' as const
  static status = 403
  static message = 'The inspected account does not match the authenticated actor'

  constructor() {
    super()
  }
}

/**
 * The inspected account does not match the authenticated actor.
 * @class
 */
export const E_MASQUERADE_ACTOR_IDENTITY_MISMATCH = ActorIdentityMismatchException

class TargetMissingException extends EligibilityException {
  static code = 'E_MASQUERADE_TARGET_MISSING' as const
  static status = 403
  static message = 'The authority did not return the requested account'

  constructor() {
    super()
  }
}

/**
 * The authority did not return the requested account.
 * @class
 */
export const E_MASQUERADE_TARGET_MISSING = TargetMissingException

class TargetInactiveException extends EligibilityException {
  static code = 'E_MASQUERADE_TARGET_INACTIVE' as const
  static status = 403
  static message = 'The requested account is inactive'

  constructor() {
    super()
  }
}

/**
 * The requested account is inactive.
 * @class
 */
export const E_MASQUERADE_TARGET_INACTIVE = TargetInactiveException

class SelfTargetException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_SELF_TARGET' as const
  static status = 422
  static message = 'The actor cannot masquerade as themselves'

  constructor() {
    super()
  }
}

/**
 * The actor cannot masquerade as themselves.
 * @class
 */
export const E_MASQUERADE_SELF_TARGET = SelfTargetException

class StoreMissingException extends RuntimeException {
  static code = 'E_MASQUERADE_STORE_MISSING' as const
  static status = 500
  static message = 'The masquerade store factory returned no store'
  readonly field = 'store' as const
  declare readonly code: 'E_MASQUERADE_STORE_MISSING'

  constructor() {
    super()
  }
}

/**
 * The masquerade store factory returned no store.
 * @class
 */
export const E_MASQUERADE_STORE_MISSING = StoreMissingException

class TestStoreForbiddenException extends RuntimeException {
  static code = 'E_MASQUERADE_TEST_STORE_FORBIDDEN' as const
  static status = 500
  static message = 'A test-only masquerade store requires a test environment'
  readonly field = 'store.testOnly' as const
  declare readonly code: 'E_MASQUERADE_TEST_STORE_FORBIDDEN'

  constructor() {
    super()
  }
}

/**
 * A test-only masquerade store requires a test environment.
 * @class
 */
export const E_MASQUERADE_TEST_STORE_FORBIDDEN = TestStoreForbiddenException

class StoreMethodMissingException extends RuntimeException {
  static code = 'E_MASQUERADE_STORE_METHOD_MISSING' as const
  static status = 500
  static message = 'The masquerade store lacks a required method'
  declare readonly code: 'E_MASQUERADE_STORE_METHOD_MISSING'

  get field(): MasqueradeSetupErrorField {
    return `store.${this.method}`
  }

  constructor(readonly method: keyof ControlStore) {
    super()
  }
}

/**
 * The masquerade store lacks a required method.
 * @class
 */
export const E_MASQUERADE_STORE_METHOD_MISSING = StoreMethodMissingException
