import { defineConfig } from '@adonisjs/auth'
import { webGuard } from '#services/web_guard'
import { effectiveSessionGuard } from '@kevinjohn/adonisjs-masquerade/auth'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'

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
