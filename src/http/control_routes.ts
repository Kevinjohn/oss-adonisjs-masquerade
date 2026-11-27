import type { MasqueradeRoutesOptions } from '../types.ts'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { Router } from '@adonisjs/core/http'
import type { MiddlewareFn, ParsedNamedMiddleware } from '@adonisjs/core/types/http'
import MasqueradeController from './masquerade_controller.ts'
import { routeGuards } from '../integration/route_guards.ts'
import { isBoundedString } from '../bounded_string.ts'

/**
 * Mount `GET /`, `POST /start` and `POST /stop` on the package controller behind the raw guard,
 * with separate start and stop limiters. `MasqueradeRuntime.registerRoutes` calls it.
 */
export function mountControlRoutes<Guard extends string>(
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
    throw new InvalidArgumentsException('registerRoutes requires the raw guard name')
  if (typeof auth !== 'function')
    throw new InvalidArgumentsException('registerRoutes requires the host auth middleware')
  if (!isMiddleware(startLimiter) || !isMiddleware(stopLimiter))
    throw new InvalidArgumentsException(
      'registerRoutes requires a start limiter and a stop limiter'
    )
  if (startLimiter === stopLimiter)
    throw new InvalidArgumentsException('registerRoutes requires separate start and stop limiters')
  if (typeof prefix !== 'string' || !prefix.startsWith('/'))
    throw new InvalidArgumentsException('registerRoutes prefix must start with /')
  if (!isBoundedString(as, 128))
    throw new InvalidArgumentsException('registerRoutes route name prefix is invalid')

  const authMiddleware = auth({ guards: [guard] })
  const guards = routeGuards({ middleware: { all: () => [authMiddleware] } }, '')
  if (guards.length !== 1 || guards[0] !== guard)
    throw new InvalidArgumentsException('registerRoutes auth must be the named auth middleware')
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
