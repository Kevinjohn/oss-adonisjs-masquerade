import type { ApplicationService } from '@adonisjs/core/types'
import { AuthManager } from '@adonisjs/auth'
import { guardRegistration } from '../../src/integration/guard_registration.ts'

/** Minimal native auth-manager binding for the standalone Ace command fixture. */
export default class AuthManagerProvider {
  #app: ApplicationService
  constructor(app: ApplicationService) {
    this.#app = app
  }

  register(): void {
    const rawFactory = (() => ({})) as never
    const effectiveFactory = guardRegistration.markEffectiveFactory((() => ({})) as never)
    const aliasFactory = guardRegistration.markEffectiveFactory((() => ({})) as never)
    this.#app.container.bindValue(
      'auth.manager',
      new AuthManager({
        default: 'web_effective',
        guards: {
          web: rawFactory,
          web_effective: effectiveFactory,
          support_effective: aliasFactory,
        },
      }) as never
    )
  }
}
