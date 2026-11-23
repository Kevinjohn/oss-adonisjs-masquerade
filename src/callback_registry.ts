import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { MasqueradeCallbacks } from './types.js'

type Factory = () =>
  MasqueradeCallbacks<unknown, unknown> | Promise<MasqueradeCallbacks<unknown, unknown>>

/** Package-internal reader; not part of the public registry API. */
export const resolveCallbacks = Symbol('masquerade.callbacks.resolve')

/** The `masquerade.callbacks` binding: an application provider registers one callback factory. */
export class MasqueradeCallbackRegistry {
  #factory?: Factory
  #resolved?: Promise<MasqueradeCallbacks<unknown, unknown> | undefined>
  /** Store the factory; it runs once, when the package first needs the callbacks. */
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
