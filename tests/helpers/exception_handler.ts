import { MasqueradeError } from '../../src/errors.js'

/** Run an operation and render a MasqueradeError as the AdonisJS default exception handler does. */
export async function handleWithDefaultExceptionHandler(
  ctx: Parameters<MasqueradeError['handle']>[1],
  operation: () => Promise<void>
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if (!(error instanceof MasqueradeError)) throw error
    error.handle(error, ctx)
  }
}
