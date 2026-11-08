// Both guards exist so the test harness can switch auth strategy; an application keeps one.
import { defineConfig } from '@adonisjs/auth'
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session'
import { tokensGuard } from '@adonisjs/auth/access_tokens'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'

import { effectiveAccessTokensGuard } from '@kevinjohn/adonisjs-masquerade/auth'
import { accessTokenUserProvider } from '#services/masquerade_user_provider'

const apiGuard = tokensGuard({ provider: accessTokenUserProvider })

const authConfig = defineConfig({
  /**
   * Default guard used when no guard is explicitly specified.
   */
  default: 'api_effective',

  guards: {
    /**
     * Token-based guard for stateless API authentication.
     */
    api: apiGuard,
    api_effective: effectiveAccessTokensGuard(apiGuard, { guard: 'api' }),

    /**
     * Session-based guard for browser authentication.
     */
    web: sessionGuard({
      /**
       * Enable persistent login using remember-me tokens.
       */
      useRememberMeTokens: false,

      provider: sessionUserProvider({
        model: () => import('#models/user'),
      }),
    }),
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
