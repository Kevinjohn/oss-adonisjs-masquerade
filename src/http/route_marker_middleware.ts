import type { HttpContext } from '@adonisjs/core/http'
import { RuntimeException } from '@adonisjs/core/exceptions'
import { routeMarkerMiddlewareName, routeMarkers } from '../integration/route_markers.ts'
import type { RouteMarkerOptions } from '../types.ts'

/**
 * Named-middleware form of `sensitive()` and `allowMutation()`. Register it in `start/kernel.ts` as
 * `masquerade`, then mark a route with `.use(middleware.masquerade({ marker: 'sensitive' }))`.
 * The context middleware reads the marker from the route; this middleware only checks, on each
 * request, that it was registered under the name the context middleware recognises.
 *
 * @example
 * ```ts
 * import type MasqueradeRouteMarkerMiddleware from '@kevinjohn/adonisjs-masquerade/route_marker_middleware'
 * import router from '@adonisjs/core/services/router'
 *
 * export const middleware = router.named({
 *   masquerade: () =>
 *     import('@kevinjohn/adonisjs-masquerade/route_marker_middleware') as Promise<{
 *       default: typeof MasqueradeRouteMarkerMiddleware
 *     }>,
 * })
 *
 * router.post('/billing', [BillingController, 'update']).use(
 *   middleware.masquerade({ marker: 'sensitive' })
 * )
 * ```
 */
export default class MasqueradeRouteMarkerMiddleware {
  /** Continue the request when the marker is visible to the context middleware; otherwise fail. */
  async handle(ctx: HttpContext, next: () => Promise<unknown>, options: RouteMarkerOptions) {
    // A marker under another name is invisible to the context middleware: fail instead of
    // letting a sensitive route through.
    if (!routeMarkers(ctx)[options?.marker])
      throw new RuntimeException(
        `Register MasqueradeRouteMarkerMiddleware as the named middleware "${routeMarkerMiddlewareName}"`
      )
    return next()
  }
}
