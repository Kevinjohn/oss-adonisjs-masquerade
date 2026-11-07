import { defineConfig } from '@adonisjs/auth'
import { sessionGuard } from '@adonisjs/auth/session'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'
import { effectiveSessionGuard } from '@kevinjohn/adonisjs-masquerade/auth'
import { userProvider } from '#services/masquerade_user_provider'

const webGuard = sessionGuard({
  /**
   * Enable persistent login using remember-me tokens.
   */
  useRememberMeTokens: false,

  provider: userProvider,
})
const authConfig = defineConfig({
  /**
   * Default guard used when no guard is explicitly specified.
   */
  default: 'web_effective',

  guards: {
    /**
     * Session-based guard for browser authentication.
     */
    web: webGuard,
    web_effective: effectiveSessionGuard(webGuard),
  },
})

export default authConfig

/**
 * Inferring types from the configured auth
 * guards.
 */
declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  interface EventsList extends InferAuthEvents<Authenticators> {}
}
