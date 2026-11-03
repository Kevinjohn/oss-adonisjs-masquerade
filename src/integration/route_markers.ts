import type { HttpContext } from '@adonisjs/core/http'

const marker = Symbol('masquerade.routeMarker')
type MarkerName = 'sensitive' | 'allowMutation'
type RouteMetadata = { middleware: { all(): Iterable<unknown> } }
/** @internal */
type MarkedMiddleware = ((ctx: HttpContext, next: () => Promise<unknown>) => Promise<unknown>) & {
  [marker]?: MarkerName
}

/** Mark a route or route group as always blocked while a masquerade is active. */
export function sensitive(): MarkedMiddleware {
  return createMarker('sensitive')
}

/** Mark unsafe actions as allowed in edit mode, except on sensitive routes. */
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
    if (typeof middleware !== 'function') continue
    const name = (middleware as MarkedMiddleware)[marker]
    if (name === 'sensitive') isSensitive = true
    if (name === 'allowMutation') permitsMutation = true
  }
  return { sensitive: isSensitive, allowMutation: permitsMutation }
}
