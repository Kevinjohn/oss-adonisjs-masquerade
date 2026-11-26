import { MasqueradeRequestException } from '../errors.ts'
import { E_MASQUERADE_ACTION_BLOCKED, E_MASQUERADE_CONTEXT_CHANGED } from '../errors.ts'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { errors } from '@adonisjs/auth'
import { requireContext } from '../context_token.ts'
import { resolveRuntime } from '../integration/runtime.ts'
import { contextEnforcement } from '../integration/context_enforcement.ts'
import { hasAuthMiddleware, routeGuards, routeMarkers } from '../integration/route_metadata.ts'

/**
 * Register after initialize_auth and before silent_auth on the host router.
 *
 * @example
 * ```ts
 * import { MasqueradeContextMiddleware } from '@kevinjohn/adonisjs-masquerade/http'
 * import router from '@adonisjs/core/services/router'
 *
 * router.use([
 *   () => import('@adonisjs/auth/initialize_auth_middleware'),
 *   async () => ({ default: MasqueradeContextMiddleware }),
 * ])
 * ```
 */
export default class MasqueradeContextMiddleware {
  /**
   * Enforce context freshness and active-mode route requirements on effective-guard routes.
   *
   * @example
   * ```ts
   * return new MasqueradeContextMiddleware().handle(ctx, next)
   * ```
   */
  async handle(ctx: HttpContext, next: NextFn): Promise<void> {
    const guards = routeGuards(ctx.route, String(ctx.auth.defaultGuard))
    if (guards.length === 0 && !hasAuthMiddleware(ctx.route)) {
      await next()
      return
    }
    // Resolve the effective aliases before choosing the boundary, but ensure
    // every potentially business-authenticated response is non-cacheable.
    setNoStore(ctx)
    const runtime = await resolveRuntime(ctx)
    // A fallback raw/token guard could bypass admission or replace the effective facade user.
    // Session-only business routes must select effective guards exclusively.
    const selected = runtime.selectGuard(ctx)
    if (selected.kind !== 'effective') {
      await next()
      return
    }
    contextEnforcement.markContextEnforced(ctx)
    const admitted = await runtime.admit(ctx).catch((error: unknown) => {
      // Named auth owns native login redirects and unauthorized rendering. Its check will
      // observe this same cached rejection; no mode state has been read or handler admitted.
      if (error instanceof errors.E_UNAUTHORIZED_ACCESS) return null
      throw error
    })
    if (!admitted) {
      await next()
      return
    }
    const { context } = admitted
    const method = ctx.request.method().toUpperCase()
    const headerToken = ctx.request.header('X-Masquerade-Context')
    // A safe request needs no token, but one that declares a stale context is refused like a write.
    if (isUnsafe(method) || headerToken !== undefined) {
      const body = ctx.request.body()
      const formToken = body && typeof body === 'object' ? body._masqueradeContext : undefined
      const mismatch =
        headerToken !== undefined && formToken !== undefined && headerToken !== formToken
      const token = headerToken ?? formToken
      let contextError: MasqueradeRequestException | undefined
      try {
        if (mismatch) throw new E_MASQUERADE_CONTEXT_CHANGED()
        requireContext(token, context.contextToken)
      } catch (error) {
        if (!(error instanceof MasqueradeRequestException)) throw error
        contextError = error
      }
      if (contextError) {
        if (runtime.config.contextEnforcement === 'enforce') throw contextError
        ctx.logger.warn({
          code: contextError.code,
          route: ctx.route?.name ?? ctx.route?.pattern,
          actorId: context.actorId,
        })
      }
    }
    if (context.isMasquerading) {
      const markers = routeMarkers(ctx)
      if (markers.sensitive) throw new E_MASQUERADE_ACTION_BLOCKED('sensitive')
      if (isUnsafe(method) && context.access !== 'edit')
        throw new E_MASQUERADE_ACTION_BLOCKED('view_only')
      if (isUnsafe(method) && !markers.allowMutation)
        throw new E_MASQUERADE_ACTION_BLOCKED('mutation_not_allowed')
    }
    await next()
  }
}

function isUnsafe(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method)
}

function setNoStore(ctx: HttpContext): void {
  ctx.response.header('Cache-Control', 'no-store')
  ctx.response.vary(['Accept', 'X-Masquerade-Context'])
}
