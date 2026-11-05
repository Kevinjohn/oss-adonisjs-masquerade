import type { HttpContext } from '@adonisjs/core/http'
import { MasqueradeError } from '../errors.js'

const enforced = new WeakSet<HttpContext>()

/** Record that `masqueradeContext` applies its route policy to this request. */
export function markContextEnforced(ctx: HttpContext): void {
  enforced.add(ctx)
}

/**
 * Refuse an active-mode identity when `masqueradeContext` did not run first. View-only,
 * `sensitive()`, `allowMutation()` and context freshness are enforced only there, so a missing
 * middleware, or one registered as server middleware, must not admit the target.
 */
export function assertContextEnforced(ctx: HttpContext, isMasquerading: boolean): void {
  if (!isMasquerading || enforced.has(ctx)) return
  ctx.logger?.error(
    { code: 'E_MASQUERADE_UNAVAILABLE', component: 'context_middleware' },
    'Masquerade context middleware did not run before effective authentication'
  )
  throw new MasqueradeError('E_MASQUERADE_UNAVAILABLE')
}
