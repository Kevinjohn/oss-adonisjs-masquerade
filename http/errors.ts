import type { HttpContext } from '@adonisjs/core/http'
import { MasqueradeRequestException } from '../src/request_exception.js'

/**
 * Identify a Masquerade request exception before adapting it to a custom response.
 *
 * @example
 * ```ts
 * import { isMasqueradeRequestError } from '@kevinjohn/adonisjs-masquerade/http'
 *
 * function supportErrorCode(error: unknown) {
 *   return isMasqueradeRequestError(error) ? error.responseCode : undefined
 * }
 * ```
 */
export function isMasqueradeRequestError(error: unknown): error is MasqueradeRequestException {
  return error instanceof MasqueradeRequestException
}

/**
 * Render only package request exceptions; framework and host exceptions remain native.
 *
 * @example
 * ```ts
 * import { renderMasqueradeError } from '@kevinjohn/adonisjs-masquerade/http'
 * import { ExceptionHandler, type HttpContext } from '@adonisjs/core/http'
 *
 * export default class HttpExceptionHandler extends ExceptionHandler {
 *   async handle(error: unknown, ctx: HttpContext) {
 *     if (renderMasqueradeError(ctx, error)) return
 *     return super.handle(error, ctx)
 *   }
 * }
 * ```
 */
export function renderMasqueradeError(ctx: HttpContext, error: unknown): boolean {
  if (!isMasqueradeRequestError(error)) return false
  error.handle(error, ctx)
  return true
}
