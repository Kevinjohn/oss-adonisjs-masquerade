import { errors as authErrors } from '@adonisjs/auth'
import { Exception, RuntimeException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type { PrunePhase, PruneResult } from './prune.ts'
import type { StopPhase } from './stop_modes.ts'

import type {
  MasqueradeBlockedBy,
  MasqueradeErrorCode,
  MasqueradeSetupErrorField,
} from './error_types.ts'

/** Shared HTTP response and translation handling for Masquerade request failures. */
/** @internal */
export abstract class MasqueradeRequestException extends Exception {
  declare readonly code: MasqueradeErrorCode
  declare readonly status: number
  readonly identifier: string
  #englishMessage: string

  constructor() {
    super()
    this.identifier = `errors.${this.code}`
    this.#englishMessage = this.message
  }

  /** Resolve host translations with the fixed public English fallback. */
  getResponseMessage(ctx: HttpContext): string {
    const i18n = (ctx as { i18n?: unknown }).i18n as
      { t?(id: string, data: Record<string, unknown>, fallback: string): string } | undefined
    if (typeof i18n?.t === 'function')
      return i18n.t(`errors.${this.code}`, {}, this.#englishMessage)
    return this.#englishMessage
  }

  /** AdonisJS self-handling: a no-store JSON response with the stable code and message. */
  handle(_error: unknown, ctx: HttpContext): void {
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.vary(['Accept', 'X-Masquerade-Context'])
    ctx.response.status(this.status).json({
      errors: [
        { code: this.code, message: this.getResponseMessage(ctx), ...this.responseDetails() },
      ],
    })
  }

  /** @internal */
  protected responseDetails(): Record<string, string> {
    return {}
  }
}

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

class UnknownActorAccountException extends InvalidInputException {}

class NativeUnauthorizedException extends authErrors.E_UNAUTHORIZED_ACCESS {
  static code = 'E_UNAUTHORIZED_ACCESS'
  static status = 401
}

/** The operator's account could not be resolved to a current incarnation. */
export const E_MASQUERADE_UNKNOWN_ACTOR_ACCOUNT = UnknownActorAccountException

/** Native credential failure, retaining the Auth exception handler and guard-specific response. */
export const E_UNAUTHORIZED_ACCESS = NativeUnauthorizedException

class ContextRequiredException extends MasqueradeRequestException {
  static code = 'E_MASQUERADE_CONTEXT_REQUIRED'
  static status = 428
  static message = 'Masquerade context required'
}

// One 503 code for every unrecognised failure conceals which store, callback or setting failed.
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
