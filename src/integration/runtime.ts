import type { HttpContext, RouteGroup, Router } from '@adonisjs/core/http'
import type { MasqueradeConfig, MasqueradeService, MasqueradeRoutesOptions } from '../types.ts'
import type { OwnerKey } from '../types.ts'
import type { RequestAdmission, RouteGuardSelection } from '../types.ts'

/**
 * Internal key for the guards `registerRoutes` mounted control routes on; deliberately absent from
 * the public API.
 * @internal
 */
export const controlRouteGuards = Symbol('controlRouteGuards')

/**
 * Resolve the registered runtime through the Masquerade container service.
 *
 * @example
 * ```ts
 * import { MasqueradeRuntime } from '@kevinjohn/adonisjs-masquerade'
 *
 * const runtime: MasqueradeRuntime = await app.container.make('masquerade.runtime')
 * const status = await runtime.service.status(ctx)
 * ```
 */
export abstract class MasqueradeRuntime<User = unknown> {
  declare readonly service: MasqueradeService<HttpContext>
  /** The validated configuration, with `authority` and `permissions` resolved. */
  declare readonly config: MasqueradeConfig<User, HttpContext> &
    Required<Pick<MasqueradeConfig<User, HttpContext>, 'authority' | 'permissions'>>
  declare readonly effectiveGuardName: string
  declare readonly effectiveGuardNames: readonly string[]
  /**
   * Classify the matched route's auth guards as `none`, `raw`, `effective` or `ambiguous`.
   *
   * @example
   * ```ts
   * const selection = runtime.selectGuard(ctx)
   * ```
   */
  abstract selectGuard(ctx: HttpContext): RouteGuardSelection
  /**
   * Admit the request once, as `MasqueradeService.resolve` does, and keep the effective subject.
   *
   * @example
   * ```ts
   * const { effective } = await runtime.admit(ctx)
   * ```
   */
  abstract admit(ctx: HttpContext): Promise<RequestAdmission<User>>
  /**
   * Whether the owner has an unexpired active mode, read from the store.
   *
   * @example
   * ```ts
   * const active = await runtime.activeMode(owner)
   * ```
   */
  abstract activeMode(owner: OwnerKey): Promise<boolean>
  /**
   * Authenticate the actor through the route's raw guard without mode admission.
   *
   * @example
   * ```ts
   * const { id } = await runtime.actor(ctx)
   * ```
   */
  abstract actor(ctx: HttpContext): Promise<{ id: string; incarnation: string }>
  /**
   * Mount `GET /`, `POST /start` and `POST /stop` on the package controller behind the raw guard,
   * with separate start and stop limiters. Returns the group so the host can add middleware. The
   * provider checks at ready that the guard is a raw guard with a native adapter.
   *
   * @example
   * ```ts
   * import router from '@adonisjs/core/services/router'
   * import runtime from '@kevinjohn/adonisjs-masquerade/services/main'
   * import { middleware } from '#start/kernel'
   * import { startMasqueradeLimiter, stopMasqueradeLimiter } from '#start/masquerade_limiter'
   *
   * runtime.registerRoutes(router, {
   *   auth: middleware.auth,
   *   guard: 'web',
   *   startLimiter: startMasqueradeLimiter,
   *   stopLimiter: stopMasqueradeLimiter,
   * })
   * ```
   */
  abstract registerRoutes<Guard extends string>(
    router: Router,
    options: MasqueradeRoutesOptions<Guard>
  ): RouteGroup
  /** @internal The guards `registerRoutes` mounted control routes on. */
  abstract [controlRouteGuards](): readonly string[]
}

export function resolveRuntime(ctx: HttpContext): Promise<MasqueradeRuntime> {
  return ctx.containerResolver.make('masquerade.runtime')
}
