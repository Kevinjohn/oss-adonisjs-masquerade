import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type { GuardConfigProvider, GuardContract } from '@adonisjs/auth/types'
import type { MasqueradeConfig } from '../src/types.js'
import { markEffectiveFactory } from '../src/integration/guard_registration.js'
import { EffectiveSessionGuard } from './effective_session_guard.js'

/**
 * Reuse the same raw session configuration for its normal and effective guards.
 *
 * @example
 * ```ts
 * import { effectiveSessionGuard } from '@kevinjohn/adonisjs-masquerade/auth'
 * import { defineConfig } from '@adonisjs/auth'
 * import { sessionGuard } from '@adonisjs/auth/session'
 * import type { SessionUserProviderContract } from '@adonisjs/auth/types/session'
 *
 * export function supportAuth(provider: SessionUserProviderContract<{ id: string }>) {
 *   const web = sessionGuard({ provider, useRememberMeTokens: false })
 *   return defineConfig({
 *     default: 'web',
 *     guards: { web, web_effective: effectiveSessionGuard(web) },
 *   })
 * }
 * ```
 */
export function effectiveSessionGuard<User>(
  raw: GuardConfigProvider<(ctx: HttpContext) => GuardContract<User>>
): GuardConfigProvider<(ctx: HttpContext) => EffectiveSessionGuard<User>> {
  return {
    async resolver(name, app) {
      const config = app.config.get<MasqueradeConfig<User, HttpContext>>('masquerade')
      // Without a configured authority, the native adapter's authority names the raw guard.
      const native = config && !config.authority && (await app.container.make('masquerade.native'))
      const guard = native ? native.authority?.guard : config?.authority?.guard
      if (!guard || guard === name)
        throw new InvalidArgumentsException('Configure distinct raw and effective session guards')
      const rawFactory = await raw.resolver(guard, app)
      return markEffectiveFactory(
        (ctx: HttpContext) => new EffectiveSessionGuard(guard, ctx, rawFactory(ctx)),
        guard,
        'session'
      )
    },
  }
}
