import { NativeAdapter } from '../integration/native_adapter.ts'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type { GuardConfigProvider, GuardContract } from '@adonisjs/auth/types'
import { resolveMasqueradeConfig } from '../define_config.ts'
import { guardRegistration } from '../integration/guard_registration.ts'
import { EffectiveSessionGuard } from './effective_session_guard.ts'

/**
 * Reuse the same raw session configuration for its normal and effective guards.
 *
 * Select the raw `web` guard explicitly on masquerade control routes.
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
 *     default: 'web_effective',
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
      const config = await resolveMasqueradeConfig<HttpContext>(app)
      // Without a configured authority, the native adapter's authority names the raw guard.
      const native = !config.authority && (await app.container.make(NativeAdapter))
      const guard = native ? native.authority?.guard : config?.authority?.guard
      if (!guard || guard === name)
        throw new InvalidArgumentsException('Configure distinct raw and effective session guards')
      const rawFactory = await raw.resolver(guard, app)
      return guardRegistration.markEffectiveFactory(
        (ctx: HttpContext) => new EffectiveSessionGuard(guard, ctx, rawFactory(ctx)),
        guard,
        'session'
      )
    },
  }
}
