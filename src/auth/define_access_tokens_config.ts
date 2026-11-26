import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type { GuardConfigProvider, GuardContract } from '@adonisjs/auth/types'
import type { symbols } from '@adonisjs/auth'
import type { AccessTokensGuard } from '@adonisjs/auth/access_tokens'
import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
import { guardRegistration } from '../integration/guard_registration.ts'
import { EffectiveAccessTokensGuard } from './effective_access_tokens_guard.ts'

/**
 * Pair a native opaque token guard with an effective-user facade.
 *
 * Select the raw `api` guard explicitly on masquerade control routes.
 *
 * @example
 * ```ts
 * import { effectiveAccessTokensGuard } from '@kevinjohn/adonisjs-masquerade/auth'
 * import { defineConfig } from '@adonisjs/auth'
 * import { tokensGuard } from '@adonisjs/auth/access_tokens'
 * import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
 *
 * export function supportAuth(provider: AccessTokensUserProviderContract<{ id: string }>) {
 *   const api = tokensGuard({ provider })
 *   return defineConfig({
 *     default: 'api_effective',
 *     guards: { api, api_effective: effectiveAccessTokensGuard(api, { guard: 'api' }) },
 *   })
 * }
 * ```
 */
export function effectiveAccessTokensGuard<
  Provider extends AccessTokensUserProviderContract<unknown>,
>(
  raw: GuardConfigProvider<(ctx: HttpContext) => AccessTokensGuard<Provider>>,
  options: { guard: string }
): GuardConfigProvider<
  (ctx: HttpContext) => EffectiveAccessTokensGuard<Provider[typeof symbols.PROVIDER_REAL_USER]>
>
export function effectiveAccessTokensGuard<User>(
  raw: GuardConfigProvider<(ctx: HttpContext) => GuardContract<User>>,
  options: { guard: string }
): GuardConfigProvider<(ctx: HttpContext) => EffectiveAccessTokensGuard<User>> {
  if (!options?.guard || typeof options.guard !== 'string')
    throw new InvalidArgumentsException('A raw access-token guard name is required')
  return {
    async resolver(name, app) {
      if (name === options.guard)
        throw new InvalidArgumentsException(
          'Configure distinct raw and effective access-token guards'
        )
      const rawFactory = await raw.resolver(options.guard, app)
      return guardRegistration.markEffectiveFactory(
        (ctx: HttpContext) => new EffectiveAccessTokensGuard(ctx, rawFactory(ctx), options.guard),
        options.guard,
        'access_tokens'
      )
    },
  }
}
