import type { HttpContext } from '@adonisjs/core/http'
import type { GuardConfigProvider, GuardContract } from '@adonisjs/auth/types'
import type { MasqueradeConfig } from '../src/types.js'
import { markEffectiveFactory } from '../integration/guard_registration.js'
import { EffectiveSessionGuard } from './effective_session_guard.js'

/** Reuse the same raw session configuration for its normal and effective guards. */
export function effectiveSessionGuard<User>(
  raw: GuardConfigProvider<(ctx: HttpContext) => GuardContract<User>>
): GuardConfigProvider<(ctx: HttpContext) => EffectiveSessionGuard<User>> {
  return {
    async resolver(name, app) {
      const config = app.config.get<MasqueradeConfig<User, HttpContext>>('masquerade')
      if (!config?.authority?.guard || config.authority.guard === name)
        throw new TypeError('Configure distinct raw and effective session guards')
      const rawFactory = await raw.resolver(config.authority.guard, app)
      return markEffectiveFactory(
        (ctx: HttpContext) =>
          new EffectiveSessionGuard(config.authority.guard, ctx, rawFactory(ctx)),
        config.authority.guard
      )
    },
  }
}
