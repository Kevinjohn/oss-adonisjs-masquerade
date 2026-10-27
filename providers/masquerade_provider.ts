import type { ApplicationService } from '@adonisjs/core/types'
import { createRuntime, runtimeConfiguration } from '../integration/runtime_factory.js'
import type { RuntimeConfiguration } from '../integration/runtime_factory.js'

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
}
export type { MasqueradeRuntime } from '../integration/runtime.js'
