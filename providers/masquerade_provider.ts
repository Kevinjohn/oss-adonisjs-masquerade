import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { ApplicationService } from '@adonisjs/core/types'
import { controlRouteGuards } from '../src/integration/control_route_guards.js'
import { createRuntime, runtimeConfiguration } from '../src/integration/runtime_factory.js'
import type { RuntimeConfiguration } from '../src/integration/runtime_factory.js'

/** Validate the complete configured runtime at boot; request auth never reads state on raw routes. */
export default class MasqueradeProvider {
  #wiring?: Promise<RuntimeConfiguration>
  constructor(protected app: ApplicationService) {}
  /** Bind `masquerade.runtime` as a lazy singleton. */
  register(): void {
    this.app.container.singleton('masquerade.runtime', async () => {
      this.#wiring ??= runtimeConfiguration(this.app)
      return createRuntime(this.app, await this.#wiring)
    })
  }
  /** Build the runtime at boot when `config/masquerade.ts` exists, so a bad config fails early. */
  async boot(): Promise<void> {
    if (this.app.config.get('masquerade') === undefined) return
    this.#wiring ??= runtimeConfiguration(this.app)
    await this.app.container.make('masquerade.runtime')
  }
  /** Refuse control routes mounted on an effective guard: every control request would fail. */
  async ready(): Promise<void> {
    if (this.app.config.get('masquerade') === undefined) return
    const guards = controlRouteGuards(await this.app.container.make('router'))
    if (guards.length === 0) return
    const runtime = await this.app.container.make('masquerade.runtime')
    for (const guard of guards)
      if (runtime.effectiveGuardNames.includes(guard))
        throw new InvalidArgumentsException(
          `masqueradeRoutes guard ${guard} is an effective guard; use the raw guard it wraps`
        )
  }
}
export type { MasqueradeRuntime } from '../src/integration/runtime.js'
