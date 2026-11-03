import type { ApplicationService } from '@adonisjs/core/types'
import { AuthManager } from '@adonisjs/auth'
import { markEffectiveFactory } from '../../src/integration/guard_registration.js'

/** Minimal native auth-manager binding for the standalone Ace command fixture. */
export default class AuthManagerProvider {
  constructor(private app: ApplicationService) {}

  register(): void {
    const rawFactory = (() => ({})) as never
    const effectiveFactory = markEffectiveFactory((() => ({})) as never)
    const aliasFactory = markEffectiveFactory((() => ({})) as never)
    this.app.container.bindValue(
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
