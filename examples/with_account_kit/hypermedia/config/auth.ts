import { defineConfig } from '@adonisjs/auth'
import { sessionGuard } from '@adonisjs/auth/session'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'
import { effectiveSessionGuard } from '@kevinjohn/adonisjs-masquerade/auth'
import { userProvider } from '#services/masquerade_user_provider'

const webGuard = sessionGuard({
  /**
   * Whether to use "remember me" tokens for persistent authentication.
   * When enabled, users can stay logged in across browser sessions.
   */
  useRememberMeTokens: false,

  /**
   * User provider configuration.
   * Defines how to fetch and verify user credentials.
   */
  provider: userProvider,
})
/**
 * Authentication configuration.
 * Defines guards and user providers for session-based authentication.
 */
const authConfig = defineConfig({
  /**
   * The default guard to use for authentication.
   * This guard will be used when no specific guard is mentioned.
   */
  default: 'web_effective',

  guards: {
    /**
     * Web guard uses session-based authentication for web requests.
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
