import type { HttpContext } from '@adonisjs/core/http'
import type { GuardConfigProvider, GuardContract } from '@adonisjs/auth/types'
import type { symbols } from '@adonisjs/auth'
import type { AccessTokensGuard } from '@adonisjs/auth/access_tokens'
import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
import { markEffectiveFactory } from '../src/integration/guard_registration.js'
import { EffectiveAccessTokensGuard } from './effective_access_tokens_guard.js'

/** Pair a native opaque token guard with an effective-user facade. */
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
    throw new TypeError('A raw access-token guard name is required')
  return {
    async resolver(name, app) {
      if (name === options.guard)
        throw new TypeError('Configure distinct raw and effective access-token guards')
      const rawFactory = await raw.resolver(options.guard, app)
      return markEffectiveFactory(
        (ctx: HttpContext) => new EffectiveAccessTokensGuard(ctx, rawFactory(ctx), options.guard),
        options.guard
      )
    },
  }
}
