import { NativeAdapter } from '../src/integration/native_adapter.ts'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { ApplicationService } from '@adonisjs/core/types'
import { createRuntime, resolveRuntimeConfiguration } from '../src/integration/runtime_builder.ts'
import type { RuntimeConfiguration } from '../src/integration/runtime_builder.ts'
import { MasqueradeCallbackRegistration, resolveCallbacks } from '../src/callback_registration.ts'
import type { MasqueradeRuntime } from '../src/integration/runtime.ts'
import type { ObserverEvent } from '../src/types.ts'

/** Validate the complete configured runtime at boot; request auth never reads state on raw routes. */
export default class MasqueradeProvider {
  #wiring?: Promise<RuntimeConfiguration>
  constructor(protected app: ApplicationService) {}
  /**
   * Bind the callback registration and runtime. Resolve the native adapter from the registered
   * callbacks when the application has not bound an adapter itself.
   */
  register(): void {
    this.app.container.singleton(
      MasqueradeCallbackRegistration,
      () => new MasqueradeCallbackRegistration()
    )
    if (!this.app.container.hasBinding(NativeAdapter))
      this.app.container.singleton(NativeAdapter, async (resolver) => {
        const registry = await resolver.make(MasqueradeCallbackRegistration)
        const callbacks = await registry[resolveCallbacks]()
        if (!callbacks?.native)
          throw new InvalidArgumentsException(
            'Masquerade needs a native adapter: bind NativeAdapter or register one through MasqueradeCallbackRegistration'
          )
        return callbacks.native
      })
    this.app.container.singleton('masquerade.runtime', async () => {
      this.#wiring ??= resolveRuntimeConfiguration(this.app)
      return createRuntime(this.app, await this.#wiring)
    })
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
    const runtime = await this.app.container.make('masquerade.runtime')
    const guards = runtime.controlRouteGuards
    if (guards.length === 0) return
    const native = await this.app.container.make(NativeAdapter)
    const rawAdapters = native.adapters ?? { [native.guard ?? native.authority.guard]: native }
    for (const guard of guards)
      if (runtime.effectiveGuardNames.includes(guard))
        throw new InvalidArgumentsException(
          `registerRoutes guard ${guard} is an effective guard; use the raw guard it wraps`
        )
      else if (!Object.hasOwn(rawAdapters, guard))
        throw new InvalidArgumentsException(`registerRoutes guard ${guard} has no native adapter`)
  }
}
export { MasqueradeRuntime } from '../src/integration/runtime.ts'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    'masquerade.runtime': MasqueradeRuntime
  }
  interface EventsList {
    'masquerade:started': ObserverEvent
    'masquerade:stopped': ObserverEvent
    'masquerade:expired': ObserverEvent
    'masquerade:invalidated': ObserverEvent
  }
}
