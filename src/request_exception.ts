import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import type { MasqueradeErrorCode } from './errors.js'

/** Shared HTTP response and translation handling for Masquerade request failures. */
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
