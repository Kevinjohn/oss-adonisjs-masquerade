import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Silently checks the raw `web` guard, so public and support-control routes stay tied to the
 * operator session (see docs/guide/clients/vue.md). Business routes authenticate `web_effective`.
 */
export default class SilentAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    await ctx.auth.use('web').check()

    return next()
  }
}
