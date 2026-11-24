import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import type { MasqueradeErrorCode, MasqueradeResponseCode } from './errors.js'

/** Shared HTTP response and translation handling for Masquerade request failures. */
export abstract class MasqueradeRequestException extends Exception {
  declare readonly code: MasqueradeErrorCode
  declare readonly status: number
  protected static publicResponse?: { code: MasqueradeResponseCode; message: string }
  readonly identifier: string
  readonly responseCode: MasqueradeResponseCode
  #englishMessage: string

  constructor(cause?: unknown) {
    super(undefined, cause === undefined ? undefined : { cause })
    const response = (this.constructor as typeof MasqueradeRequestException).publicResponse
    this.responseCode = response?.code ?? this.code
    this.identifier = `errors.${this.responseCode}`
    this.#englishMessage = response?.message ?? this.message
  }

  /** Resolve host translations with the fixed public English fallback. */
  getResponseMessage(ctx: HttpContext): string {
    const i18n = (ctx as { i18n?: unknown }).i18n as
      { t?(id: string, data: Record<string, unknown>, fallback: string): string } | undefined
    if (typeof i18n?.t === 'function')
      return i18n.t(`errors.${this.responseCode}`, {}, this.#englishMessage)
    return this.#englishMessage
  }

  /** AdonisJS self-handling: a no-store JSON response with the stable code and message. */
  handle(_error: unknown, ctx: HttpContext): void {
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.vary(['Accept', 'X-Masquerade-Context'])
    ctx.response.status(this.status).json({
      errors: [
        {
          code: this.responseCode,
          message: this.getResponseMessage(ctx),
          ...this.responseDetails(),
        },
      ],
    })
  }

  /** @internal */
  protected responseDetails(): Record<string, string> {
    return {}
  }
}

/** @internal */
export abstract class GuardWiringException extends MasqueradeRequestException {
  // Hide guard names, adapter setup and middleware wiring from request clients.
  protected static publicResponse = {
    code: 'E_MASQUERADE_UNAVAILABLE',
    message: 'Masquerade is unavailable',
  } as const
}

/** @internal */
export abstract class EligibilityException extends MasqueradeRequestException {
  // Use one denial response so the result cannot expose account existence or eligibility.
  protected static publicResponse = {
    code: 'E_MASQUERADE_NOT_ALLOWED',
    message: 'Masquerade is not allowed',
  } as const
}
