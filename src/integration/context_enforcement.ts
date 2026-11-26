import { E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import type { HttpContext } from '@adonisjs/core/http'

class ContextEnforcement {
  #enforced = new WeakSet<HttpContext>()

  /** Record that `masqueradeContext` applies its route permissions to this request. */
  markContextEnforced(ctx: HttpContext): void {
    this.#enforced.add(ctx)
  }

  /**
   * Refuse an active-mode identity when `masqueradeContext` did not run first. View-only,
   * `sensitive()`, `allowMutation()` and context freshness are this.#enforced only there, so a missing
   * middleware, or one registered as server middleware, must not admit the target.
   */
  assertContextEnforced(ctx: HttpContext, { isMasquerading }: { isMasquerading: boolean }): void {
    if (!isMasquerading || this.#enforced.has(ctx)) return
    ctx.logger?.error(
      { code: 'E_MASQUERADE_UNAVAILABLE', component: 'context_middleware' },
      'Masquerade context middleware did not run before effective authentication'
    )
    throw new E_MASQUERADE_UNAVAILABLE()
  }
}

export const contextEnforcement = new ContextEnforcement()
