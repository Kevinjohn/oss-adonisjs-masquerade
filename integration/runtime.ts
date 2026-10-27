import type { HttpContext } from '@adonisjs/core/http'
import type { MasqueradeConfig, MasqueradeService, OwnerKey } from '../src/types.js'
import type { RequestAdmission } from '../src/request_admission.js'
import type { RouteGuardSelection } from './route_guard_selection.js'

/** The `masquerade.runtime` container binding the provider registers. */
export interface MasqueradeRuntime<User = unknown> {
  readonly service: MasqueradeService<HttpContext>
  readonly config: MasqueradeConfig<User, HttpContext>
  readonly effectiveGuardName: string
  readonly effectiveGuardNames: readonly string[]
  /** Classify the matched route's auth guards as `none`, `raw`, `effective` or `ambiguous`. */
  selectGuard(ctx: HttpContext): RouteGuardSelection
  /** Admit the request once, as `MasqueradeService.resolve` does, and keep the effective subject. */
  admit(ctx: HttpContext): Promise<RequestAdmission<User>>
  /** Whether the owner has an unexpired active mode, read from the store. */
  activeMode(owner: OwnerKey): Promise<boolean>
}

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    'masquerade.runtime': MasqueradeRuntime
  }
}

export function runtimeFor(ctx: HttpContext): Promise<MasqueradeRuntime> {
  return ctx.containerResolver.make('masquerade.runtime')
}
