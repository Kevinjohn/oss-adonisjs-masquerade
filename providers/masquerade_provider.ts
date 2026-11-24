import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { ApplicationService } from '@adonisjs/core/types'
import { listControlRouteGuards } from '../src/integration/control_route_guards.js'
import { createRuntime, resolveRuntimeConfiguration } from '../src/integration/runtime_factory.js'
import type { RuntimeConfiguration } from '../src/integration/runtime_factory.js'
import { MasqueradeCallbackRegistry, resolveCallbacks } from '../src/callback_registry.js'
import { MasqueradeRuntime } from '../src/integration/runtime.js'
// A side-effect import is retained in the emitted declaration, unlike a type-only empty import.
import '../src/integration/events.js'

/** Validate the complete configured runtime at boot; request auth never reads state on raw routes. */
export default class MasqueradeProvider {
  #wiring?: Promise<RuntimeConfiguration>
  constructor(protected app: ApplicationService) {}
  /**
   * Bind `masquerade.callbacks`, `masquerade.runtime` as a lazy singleton that `MasqueradeRuntime`
   * also resolves to and, unless the application binds it, `masquerade.native` from the registered
   * callbacks.
   */
  register(): void {
    this.app.container.singleton(MasqueradeCallbackRegistry, () => new MasqueradeCallbackRegistry())
    this.app.container.alias('masquerade.callbacks', MasqueradeCallbackRegistry)
    if (!this.app.container.hasBinding('masquerade.native'))
      this.app.container.singleton('masquerade.native', async (resolver) => {
        const registry = await resolver.make('masquerade.callbacks')
        const callbacks = await registry[resolveCallbacks]()
        if (!callbacks?.native)
          throw new InvalidArgumentsException(
            'Masquerade needs a native adapter: bind masquerade.native or register one through masquerade.callbacks'
          )
        return callbacks.native
      })
    this.app.container.singleton('masquerade.runtime', async () => {
      this.#wiring ??= resolveRuntimeConfiguration(this.app)
      return createRuntime(this.app, await this.#wiring)
    })
    // Resolve the class through the key, so a runtime bound under `masquerade.runtime` wins for both.
    this.app.container.bind(MasqueradeRuntime, (resolver) => resolver.make('masquerade.runtime'))
  }
  /** Build the runtime at boot when `config/masquerade.ts` exists, so a bad config fails early. */
  async boot(): Promise<void> {
    if (this.app.config.get('masquerade') === undefined) return
    this.#wiring ??= resolveRuntimeConfiguration(this.app)
    await this.app.container.make('masquerade.runtime')
  }
  /** Refuse control routes mounted on an effective guard: every control request would fail. */
  async ready(): Promise<void> {
    if (this.app.config.get('masquerade') === undefined) return
    const guards = listControlRouteGuards(await this.app.container.make('router'))
    if (guards.length === 0) return
    const runtime = await this.app.container.make('masquerade.runtime')
    const native = await this.app.container.make('masquerade.native')
    const rawAdapters = native.adapters ?? { [native.guard ?? native.authority.guard]: native }
    for (const guard of guards)
      if (runtime.effectiveGuardNames.includes(guard))
        throw new InvalidArgumentsException(
          `masqueradeRoutes guard ${guard} is an effective guard; use the raw guard it wraps`
        )
      else if (!Object.hasOwn(rawAdapters, guard))
        throw new InvalidArgumentsException(`masqueradeRoutes guard ${guard} has no native adapter`)
  }
}
export { MasqueradeRuntime } from '../src/integration/runtime.js'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    'masquerade.callbacks': MasqueradeCallbackRegistry
  }
}
