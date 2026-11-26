import type { MasqueradeRoutesOptions } from '../types.ts'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { Router } from '@adonisjs/core/http'
import type { MiddlewareFn, ParsedNamedMiddleware } from '@adonisjs/core/types/http'
import MasqueradeController from './masquerade_controller.ts'
import { routeGuards } from '../integration/route_guards.ts'
import { isBoundedString } from '../bounded_string.ts'
import { controlRouteGuards } from '../integration/control_route_guards.ts'

/**
 * Mount `GET /`, `POST /start` and `POST /stop` on the package controller behind the raw guard,
 * with separate start and stop limiters. Returns the group so the host can add middleware.
 *
 * @example
 * ```ts
 * import { masqueradeRoutes } from '@kevinjohn/adonisjs-masquerade/http'
 * import type { MasqueradeRoutesOptions } from '@kevinjohn/adonisjs-masquerade/types'
 * import router from '@adonisjs/core/services/router'
 *
 * export function mountSupportControls(
 *   middleware: Pick<MasqueradeRoutesOptions<'web'>, 'auth' | 'startLimiter' | 'stopLimiter'>
 * ) {
 *   return masqueradeRoutes(router, { ...middleware, guard: 'web', prefix: '/support/modes' })
 * }
 * ```
 */
export function masqueradeRoutes<Guard extends string>(
  router: Router,
  options: MasqueradeRoutesOptions<Guard>
) {
  const {
    auth,
    guard,
    startLimiter,
    stopLimiter,
    prefix = '/masquerade',
    as = 'masquerade',
  } = options ?? ({} as MasqueradeRoutesOptions<Guard>)
  if (!isBoundedString(guard, 128))
    throw new InvalidArgumentsException('masqueradeRoutes requires the raw guard name')
  if (typeof auth !== 'function')
    throw new InvalidArgumentsException('masqueradeRoutes requires the host auth middleware')
  if (!isMiddleware(startLimiter) || !isMiddleware(stopLimiter))
    throw new InvalidArgumentsException(
      'masqueradeRoutes requires a start limiter and a stop limiter'
    )
  if (startLimiter === stopLimiter)
    throw new InvalidArgumentsException(
      'masqueradeRoutes requires separate start and stop limiters'
    )
  if (typeof prefix !== 'string' || !prefix.startsWith('/'))
    throw new InvalidArgumentsException('masqueradeRoutes prefix must start with /')
  if (!isBoundedString(as, 128))
    throw new InvalidArgumentsException('masqueradeRoutes route name prefix is invalid')

  const authMiddleware = auth({ guards: [guard] })
  const guards = routeGuards({ middleware: { all: () => [authMiddleware] } }, '')
  if (guards.length !== 1 || guards[0] !== guard)
    throw new InvalidArgumentsException('masqueradeRoutes auth must be the named auth middleware')
  // Effective guards are known only once auth resolves; the provider checks this guard at ready.
  controlRouteGuards.recordControlRouteGuard(router, guard)

  return router
    .group(() => {
      router.get('/', [MasqueradeController, 'status']).as('status')
      router.post('/start', [MasqueradeController, 'start']).as('start').use(startLimiter)
      router.post('/stop', [MasqueradeController, 'stop']).as('stop').use(stopLimiter)
    })
    .prefix(prefix)
    .as(as)
    .use(authMiddleware)
}

function isMiddleware(value: unknown): value is MiddlewareFn | ParsedNamedMiddleware {
  return typeof value === 'function' || (typeof value === 'object' && value !== null)
}
