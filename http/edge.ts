import type { HttpContext } from '@adonisjs/core/http'
import type { ModeView } from '../src/types.js'
import { resolveRuntime } from '../src/integration/runtime.js'

/**
 * Share the safe status projection and a token-only hidden-field renderer with Edge. An effective
 * route shares its memoized admission; any other route shares read-only status, so it never
 * admits, invalidates or applies `canUseRequest` for a request that runs as the actor.
 *
 * @example
 * ```ts
 * import { shareMasquerade } from '@kevinjohn/adonisjs-masquerade/http'
 * import type { HttpContext } from '@adonisjs/core/http'
 * import type { NextFn } from '@adonisjs/core/types/http'
 *
 * export default class ShareSupportStateMiddleware {
 *   async handle(ctx: HttpContext, next: NextFn) {
 *     await shareMasquerade(ctx)
 *     return next()
 *   }
 * }
 * ```
 */
export async function shareMasquerade(ctx: HttpContext): Promise<ModeView> {
  const runtime = await resolveRuntime(ctx)
  let mode: ModeView
  if (runtime.selectGuard(ctx).kind === 'effective') {
    const admitted = await runtime.admit(ctx)
    mode = admitted.view
  } else mode = await runtime.service.status(ctx)
  ctx.response.header('Cache-Control', 'private, no-store')
  const edge = ctx as HttpContext & {
    view?: { share(values: Record<string, unknown>): unknown }
  }
  edge.view?.share({ masquerade: mode, masqueradeContextField: () => contextField(mode) })
  return mode
}

/**
 * Render with Edge's raw-output syntax; the token alphabet is strictly validated.
 *
 * @example
 * ```ts
 * import { contextField, shareMasquerade } from '@kevinjohn/adonisjs-masquerade/http'
 * import type { HttpContext } from '@adonisjs/core/http'
 *
 * export async function supportContextInput(ctx: HttpContext) {
 *   return contextField(await shareMasquerade(ctx))
 * }
 * ```
 */
export function contextField(mode: ModeView): string {
  return `<input type="hidden" name="_masqueradeContext" value="${escapeAttribute(mode.contextToken)}">`
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"'<>]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      case '<':
        return '&lt;'
      default:
        return '&gt;'
    }
  })
}
