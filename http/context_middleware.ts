import type { HttpContext } from '@adonisjs/core/http'
import { errors } from '@adonisjs/auth'
import { MasqueradeError } from '../src/errors.js'
import { requireContext } from '../src/context_token.js'
import { runtimeFor } from '../src/integration/runtime.js'
import { markContextEnforced } from '../src/integration/context_enforcement.js'
import { hasAuthMiddleware, routeGuards, routeMarkers } from '../src/integration/route_metadata.js'

/** Enforce context freshness and active-mode route policy on effective-guard routes. */
export async function masqueradeContext(
  ctx: HttpContext,
  next: () => Promise<unknown>
): Promise<void> {
  const guards = routeGuards(ctx.route, String(ctx.auth.defaultGuard))
  if (guards.length === 0 && !hasAuthMiddleware(ctx.route)) {
    await next()
    return
  }

  // Resolve the effective aliases before choosing the boundary, but ensure
  // every potentially business-authenticated response is non-cacheable.
  setNoStore(ctx)
  const runtime = await runtimeFor(ctx)
  // A fallback raw/token guard could bypass admission or replace the effective facade user.
  // Session-only business routes must select effective guards exclusively.
  const selected = runtime.selectGuard(ctx)
  if (selected.kind !== 'effective') {
    await next()
    return
  }
  markContextEnforced(ctx)
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
  if (isUnsafe(method)) {
    const body = ctx.request.body()
    const headerToken = ctx.request.header('X-Masquerade-Context')
    const formToken = body && typeof body === 'object' ? body._masqueradeContext : undefined
    const mismatch =
      headerToken !== undefined && formToken !== undefined && headerToken !== formToken
    const token = headerToken ?? formToken
    let contextError: MasqueradeError | undefined
    try {
      if (mismatch) throw new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
      requireContext(token, context.contextToken)
    } catch (error) {
      if (!(error instanceof MasqueradeError)) throw error
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
    if (markers.sensitive)
      throw new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED', {
        blockedBy: 'sensitive',
      })
    if (isUnsafe(method) && context.access !== 'edit')
      throw new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED', { blockedBy: 'view_only' })
    if (isUnsafe(method) && !markers.allowMutation)
      throw new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED', {
        blockedBy: 'mutation_not_allowed',
      })
  }
  await next()
}

function isUnsafe(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method)
}

function setNoStore(ctx: HttpContext): void {
  ctx.response.header('Cache-Control', 'no-store')
  ctx.response.vary(['Accept', 'X-Masquerade-Context'])
}
