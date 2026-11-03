import type { HttpContext } from '@adonisjs/core/http'
import type { ModeView } from '../src/types.js'
import { runtimeFor } from '../src/integration/runtime.js'

/** Share the safe status projection and a token-only hidden-field renderer with Edge. */
export async function shareMasquerade(ctx: HttpContext): Promise<ModeView> {
  const runtime = await runtimeFor(ctx)
  const admitted = await runtime.admit(ctx)
  const mode = admitted.view
  const edge = ctx as HttpContext & {
    view?: { share(values: Record<string, unknown>): unknown }
  }
  edge.view?.share({ masquerade: mode, masqueradeContextField: () => contextField(mode) })
  return mode
}

/** Render with Edge's raw-output syntax; the token alphabet is strictly validated. */
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
