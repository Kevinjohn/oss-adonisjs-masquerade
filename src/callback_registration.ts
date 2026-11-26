import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { MasqueradeCallbacks } from './types.ts'

type Factory = () =>
  MasqueradeCallbacks<unknown, unknown> | Promise<MasqueradeCallbacks<unknown, unknown>>

/** Package-internal reader; not part of the public registry API. */
export const resolveCallbacks = Symbol('masquerade.callbacks.resolve')

/**
 * The `MasqueradeCallbackRegistration` binding: an application provider registers one callback factory.
 * List the application provider before the Masquerade provider in `adonisrc.ts`.
 *
 * @example
 * ```ts
 * import { MasqueradeCallbackRegistration } from '@kevinjohn/adonisjs-masquerade'
 * import type { ApplicationService } from '@adonisjs/core/types'
 *
 * export default class SupportCallbacksProvider {
 *   constructor(protected app: ApplicationService) {}
 *
 *   async boot() {
 *     const registry = await this.app.container.make(MasqueradeCallbackRegistration)
 *     registry.register(async () => {
 *       const { nativeAdapter, masqueradePermissions } =
 *         await import('../app/services/auth/masquerade_authority.js')
 *       return { native: nativeAdapter, permissions: masqueradePermissions }
 *     })
 *   }
 * }
 * ```
 */
export class MasqueradeCallbackRegistration {
  #factory?: Factory
  #resolved?: Promise<MasqueradeCallbacks<unknown, unknown> | undefined>
  /**
   * Store the factory; it runs once, when the package first needs the callbacks.
   *
   * @example
   * ```ts
   * registry.register(() => ({
   *   permissions: {
   *     canMasquerade: ({ actor, target }) =>
   *       actor.id === 'support-operator' && target.id === 'customer-42',
   *   },
   * }))
   * ```
   */
  register<User, Request>(
    factory: () => MasqueradeCallbacks<User, Request> | Promise<MasqueradeCallbacks<User, Request>>
  ): void {
    if (this.#factory)
      throw new InvalidArgumentsException('Masquerade callbacks are already registered')
    if (this.#resolved)
      throw new InvalidArgumentsException(
        'Masquerade callbacks must be registered before masquerade.runtime is first resolved'
      )
    this.#factory = factory as Factory
  }
  /** Await the factory once and memoise the result; undefined when nothing was registered. */
  [resolveCallbacks](): Promise<MasqueradeCallbacks<unknown, unknown> | undefined> {
    const factory = this.#factory
    this.#resolved ??= (async () => factory?.())()
    return this.#resolved
  }
}
