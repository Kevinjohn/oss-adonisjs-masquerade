import type { HttpContext } from '@adonisjs/core/http'
import type { MasqueradeConfig, MasqueradeService, OwnerKey } from '../types.ts'
import type { RequestAdmission } from '../request_admission.ts'
import type { RouteGuardSelection } from './route_guard_selection.ts'

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
}

export function resolveRuntime(ctx: HttpContext): Promise<MasqueradeRuntime> {
  return ctx.containerResolver.make('masquerade.runtime')
}
