import type { HttpContext } from '@adonisjs/core/http'
import AccountKitAccountBlocker from './account_blocker_middleware.ts'
import { classifyAccountKitRoute } from '../integration/account_kit_route_classification.ts'
import { assertManagedRouteRegistration } from './route_validation.ts'
import { readManagedRegistration } from './registration.ts'

/**
 * Global blocker for Account Kit's registered managed routes.
 *
 * @example
 * ```ts
 * import router from '@adonisjs/core/services/router'
 *
 * router.use([
 *   () => import('@adonisjs/auth/initialize_auth_middleware'),
 *   () => import('@kevinjohn/adonisjs-masquerade/account-kit/managed_blocker_middleware'),
 * ])
 * ```
 */
export default class AccountKitBlocker extends AccountKitAccountBlocker {
  /**
   * Block managed `accountKit.*` routes while a mode is active, except logout and CSRF, after
   * checking the managed route registration. Other routes pass through.
   */
  async handle(ctx: HttpContext, next: () => Promise<unknown>): Promise<unknown> {
    if (classifyAccountKitRoute(ctx.route?.name) !== 'managed') return next()
    const router = await ctx.containerResolver.make('router')
    assertManagedRouteRegistration(router.toJSON(), await readManagedRegistration(router))
    return super.handle(ctx, next)
  }
}
