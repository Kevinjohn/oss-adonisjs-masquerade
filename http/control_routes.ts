import type { Router } from '@adonisjs/core/http'
import type { MiddlewareFn, ParsedNamedMiddleware } from '@adonisjs/core/types/http'
import { MasqueradeController } from './controllers.js'
import { routeGuards } from '../integration/route_guards.js'
import { boundedString } from '../src/bounded_string.js'

/** Options for `masqueradeRoutes`. */
export interface MasqueradeRoutesOptions<Guard extends string> {
  /** The host's named auth middleware, usually `middleware.auth` from `#start/kernel`. */
  auth: (options: { guards: Guard[] }) => MiddlewareFn | ParsedNamedMiddleware
  /** The raw guard that authenticates the operator, such as `web` or `api`. */
  guard: Guard
  /** Limiter for `POST /start`. */
  startLimiter: MiddlewareFn | ParsedNamedMiddleware
  /** Limiter for `POST /stop`, with its own budget. */
  stopLimiter: MiddlewareFn | ParsedNamedMiddleware
  /** Defaults to `/masquerade`. */
  prefix?: string
  /** Route name prefix; defaults to `masquerade`, giving `masquerade.status|start|stop`. */
  as?: string
}

/**
 * Mount `GET /`, `POST /start` and `POST /stop` on the package controller behind the raw guard,
 * with separate start and stop limiters. Returns the group so the host can add middleware.
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
  if (!boundedString(guard, 128))
    throw new TypeError('masqueradeRoutes requires the raw guard name')
  if (typeof auth !== 'function')
    throw new TypeError('masqueradeRoutes requires the host auth middleware')
  if (!isMiddleware(startLimiter) || !isMiddleware(stopLimiter))
    throw new TypeError('masqueradeRoutes requires a start limiter and a stop limiter')
  if (startLimiter === stopLimiter)
    throw new TypeError('masqueradeRoutes requires separate start and stop limiters')
  if (typeof prefix !== 'string' || !prefix.startsWith('/'))
    throw new TypeError('masqueradeRoutes prefix must start with /')
  if (!boundedString(as, 128)) throw new TypeError('masqueradeRoutes route name prefix is invalid')

  const authMiddleware = auth({ guards: [guard] })
  const guards = routeGuards({ middleware: { all: () => [authMiddleware] } }, '')
  if (guards.length !== 1 || guards[0] !== guard)
    throw new TypeError('masqueradeRoutes auth must be the named auth middleware')

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
