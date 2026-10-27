import type { HttpContext } from '@adonisjs/core/http'
import type { Subject } from '../src/types.js'

/** Model-erased container boundary; concrete adapters retain their own User typing. */
export interface NativeRuntimeAdapter {
  readonly authority: { readonly namespace: string; readonly guard: string }
  /** Raw native guard selected for this adapter when it differs from authority.guard. */
  readonly guard?: string
  /** Native adapters keyed by their raw Auth guard name when multiple transports share an authority. */
  readonly adapters?: Readonly<Record<string, NativeRuntimeAdapter>>
  /** Authenticate the actor through this adapter's raw guard. */
  authenticateActor(ctx: HttpContext): Promise<Subject<unknown>>
}
declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    'masquerade.native': NativeRuntimeAdapter
  }
}
