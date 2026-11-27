import type { HttpContext } from '@adonisjs/core/http'

const marker = Symbol('masquerade.routeMarker')
/** The name the application registers `MasqueradeRouteMarkerMiddleware` under in `start/kernel.ts`. */
export const routeMarkerMiddlewareName = 'masquerade'
type MarkerName = 'sensitive' | 'allowMutation'
type RouteMetadata = { middleware: { all(): Iterable<unknown> } }
/** @internal */
type MarkedMiddleware = ((ctx: HttpContext, next: () => Promise<unknown>) => Promise<unknown>) & {
  [marker]?: MarkerName
}

/**
 * Mark a route or route group as always blocked while a masquerade is active.
 *
 * @example
 * ```ts
 * import { sensitive } from '@kevinjohn/adonisjs-masquerade/http'
 * import router from '@adonisjs/core/services/router'
 * import type { HttpContext } from '@adonisjs/core/http'
 *
 * export function mountBilling(updateBilling: (ctx: HttpContext) => Promise<void>) {
 *   router.post('/billing', updateBilling).use(sensitive())
 * }
 * ```
 */
export function sensitive(): MarkedMiddleware {
  return createMarker('sensitive')
}

/**
 * Mark unsafe actions as allowed in edit mode, except on sensitive routes.
 *
 * @example
 * ```ts
 * import { allowMutation } from '@kevinjohn/adonisjs-masquerade/http'
 * import router from '@adonisjs/core/services/router'
 * import type { HttpContext } from '@adonisjs/core/http'
 *
 * export function mountPreferences(updatePreferences: (ctx: HttpContext) => Promise<void>) {
 *   router.patch('/preferences', updatePreferences).use(allowMutation())
 * }
 * ```
 */
export function allowMutation(): MarkedMiddleware {
  return createMarker('allowMutation')
}

function createMarker(name: MarkerName): MarkedMiddleware {
  const middleware: MarkedMiddleware = async (_ctx, next) => next()
  Object.defineProperty(middleware, marker, { value: name })
  return middleware
}

/** Read marker state from the actual matched route, including inherited group middleware. */
export function routeMarkers(ctx: { route?: RouteMetadata }): {
  sensitive: boolean
  allowMutation: boolean
} {
  let isSensitive = false
  let permitsMutation = false
  for (const middleware of ctx.route?.middleware.all() ?? []) {
    const name = markerName(middleware)
    if (name === 'sensitive') isSensitive = true
    if (name === 'allowMutation') permitsMutation = true
  }
  return { sensitive: isSensitive, allowMutation: permitsMutation }
}

/** The marker a function marker or the named `masquerade` middleware carries, if any. */
function markerName(middleware: unknown): MarkerName | undefined {
  if (typeof middleware === 'function') return (middleware as MarkedMiddleware)[marker]
  if (typeof middleware !== 'object' || middleware === null) return undefined
  const named = middleware as { name?: unknown; args?: unknown }
  if (named.name !== routeMarkerMiddlewareName) return undefined
  const options = Array.isArray(named.args) ? named.args[0] : named.args
  const value = (options as { marker?: unknown } | undefined)?.marker
  return value === 'sensitive' || value === 'allowMutation' ? value : undefined
}
