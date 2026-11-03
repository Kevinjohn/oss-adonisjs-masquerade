import type { HttpContext } from '@adonisjs/core/http'
import { Exception, RuntimeException } from '@adonisjs/core/exceptions'
import { errorDetails } from './error_helpers.js'

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

/** Boot-time configuration error codes, thrown as `MasqueradeSetupError`. */
export type MasqueradeSetupErrorCode =
  'E_MASQUERADE_INVALID_CONFIGURATION' | 'E_MASQUERADE_INVALID_STORE'

/** The configuration field a `MasqueradeSetupError` names. */
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

/** Safe setup diagnostics for synchronous configuration and store contract failures. */
export class MasqueradeSetupError extends RuntimeException {
  constructor(
    readonly code: MasqueradeSetupErrorCode,
    readonly field: MasqueradeSetupErrorField
  ) {
    super(
      code === 'E_MASQUERADE_INVALID_CONFIGURATION'
        ? 'Invalid masquerade configuration'
        : 'Invalid masquerade store for environment',
      { code }
    )
    this.name = 'MasqueradeSetupError'
  }
}

/** Safe request error. Action blocks identify the route rule that caused the denial. */
export class MasqueradeError extends Exception {
  readonly identifier: string
  readonly status: number
  readonly blockedBy?: MasqueradeBlockedBy

  constructor(code: 'E_MASQUERADE_ACTION_BLOCKED', options: { blockedBy: MasqueradeBlockedBy })
  constructor(code: Exclude<MasqueradeErrorCode, 'E_MASQUERADE_ACTION_BLOCKED'>)
  constructor(
    readonly code: MasqueradeErrorCode,
    options?: { blockedBy: MasqueradeBlockedBy }
  ) {
    super(errorDetails[code][1], { code, status: errorDetails[code][0] })
    this.name = 'MasqueradeError'
    this.identifier = `errors.${code}`
    this.status = errorDetails[code][0]
    this.blockedBy = options?.blockedBy
  }

  /** Resolve host translations with the fixed public English fallback. */
  getResponseMessage(ctx: HttpContext): string {
    if ('i18n' in ctx) {
      const i18n = ctx.i18n as {
        t(id: string, data: Record<string, unknown>, fallback: string): string
      }
      return i18n.t(`errors.${this.code}`, {}, errorDetails[this.code][1])
    }
    return errorDetails[this.code][1]
  }

  /** AdonisJS self-handling: a no-store JSON `{ errors: [{ code, message, blockedBy? }] }` response. */
  handle(_error: unknown, ctx: HttpContext): void {
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.vary(['Accept', 'X-Masquerade-Context'])
    ctx.response.status(this.status).json({
      errors: [
        {
          code: this.code,
          message: this.getResponseMessage(ctx),
          ...(this.code === 'E_MASQUERADE_ACTION_BLOCKED' && this.blockedBy !== undefined
            ? { blockedBy: this.blockedBy }
            : {}),
        },
      ],
    })
  }
}
