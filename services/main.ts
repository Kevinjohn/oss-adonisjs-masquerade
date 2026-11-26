import app from '@adonisjs/core/services/app'
import type { MasqueradeRuntime } from '../src/integration/runtime.ts'
// Load the provider's binding declarations for consumers of this subpath.
import '../providers/masquerade_provider.ts'

let runtime: MasqueradeRuntime

await app.booted(async () => {
  runtime = await app.container.make('masquerade.runtime')
})

/**
 * The booted Masquerade runtime.
 *
 * @example
 * ```ts
 * import runtime from '@kevinjohn/adonisjs-masquerade/services/main'
 * const mode = await runtime.service.status(ctx)
 * ```
 */
export { runtime as default }
