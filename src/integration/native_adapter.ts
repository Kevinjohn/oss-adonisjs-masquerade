import type { HttpContext } from '@adonisjs/core/http'
import type { NativeRuntimeAdapter, Subject } from '../types.ts'

/**
 * Container key for the application's native adapter.
 *
 * @example
 * ```ts
 * app.container.bindValue(NativeAdapter, nativeAdapter)
 * ```
 */
export abstract class NativeAdapter implements NativeRuntimeAdapter {
  abstract readonly authority: NativeRuntimeAdapter['authority']
  readonly guard?: string
  readonly driverName?: 'session' | 'access_tokens'
  readonly adapters?: NativeRuntimeAdapter['adapters']

  /**
   * Authenticate the actor through the adapter's raw guard.
   *
   * @example
   * ```ts
   * const actor = await adapter.authenticateActor(ctx)
   * ```
   */
  abstract authenticateActor(ctx: HttpContext): Promise<Subject<unknown>>
}
