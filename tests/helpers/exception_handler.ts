import type { HttpContext } from '@adonisjs/core/http'
import { renderMasqueradeError } from '../../http/main.ts'

/** Run an operation and render a request exception as the AdonisJS default exception handler does. */
export async function handleWithDefaultExceptionHandler(
  ctx: HttpContext,
  operation: () => Promise<void>
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if (!renderMasqueradeError(ctx, error)) throw error
  }
}
