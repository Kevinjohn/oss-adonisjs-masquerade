import { defineConfig } from '@adonisjs/auth'
import { memberGuard } from '#services/member_guard'
import { apiGuard, webGuard } from '#services/web_guard'
import {
  effectiveAccessTokensGuard,
  effectiveSessionGuard,
} from '@kevinjohn/adonisjs-masquerade/auth'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'

/**
 * Authentication configuration.
 * Defines guards and user providers for session-based authentication.
 */
const tokenOnly = process.env.MASQUERADE_TRANSPORT === 'tokens'
const guards = {
  web: webGuard,
  api: apiGuard,
  members: memberGuard,
  web_effective: effectiveSessionGuard(webGuard),
  api_effective: effectiveAccessTokensGuard(apiGuard, { guard: 'api' }),
}

const authConfig = defineConfig({
  /**
   * The default guard to use for authentication.
   * This guard will be used when no specific guard is mentioned.
   */
  default: tokenOnly ? 'api_effective' : 'web_effective',

  // Keep the mixed guard type stable for fixture routes while the token-only
  // installation registers no session credential guards at runtime.
  guards: (tokenOnly
    ? { api: guards.api, api_effective: guards.api_effective }
    : guards) as typeof guards,
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
