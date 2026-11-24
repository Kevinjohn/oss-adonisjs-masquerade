import { MasqueradeRequestException } from '../src/request_exception.js'
import { E_MASQUERADE_ACTION_BLOCKED, E_MASQUERADE_UNAVAILABLE } from '../src/errors.js'
import type { HttpContext } from '@adonisjs/core/http'
import { resolveAccountOwner } from './account_owner.js'
import { resolveRuntime } from '../src/integration/runtime.js'
import { classifyAccountKitRoute } from '../src/integration/account_kit_route_classification.js'
import type { AccountKitAdapter } from './main.js'
import type { GuardContract } from '@adonisjs/auth/types'
import { assertManagedRouteRegistration } from './route_validation.js'
import { readManagedRegistration } from './registration.js'

/**
 * Opt-in blocker for host-owned native account routes. Keep logout and CSRF outside its group.
 *
 * @example
 * ```ts
 * import { AccountKitAccountBlocker } from '@kevinjohn/adonisjs-masquerade/account-kit/middleware'
 * import type { HttpContext, Router } from '@adonisjs/core/http'
 *
 * export function mountNativeAccountRoutes(
 *   router: Router,
 *   updateEmail: (ctx: HttpContext) => Promise<void>
 * ) {
 *   const middleware = router.named({
 *     accountKitAccountBlocker: async () => ({ default: AccountKitAccountBlocker }),
 *   })
 *   router
 *     .group(() => {
 *       router.post('/account/email', updateEmail)
 *     })
 *     .use(middleware.accountKitAccountBlocker())
 * }
 * ```
 */
export class AccountKitAccountBlocker {
  /** Refuse the route with `E_MASQUERADE_ACTION_BLOCKED` (`sensitive`) while a mode is active. */
  async handle(ctx: HttpContext, next: () => Promise<unknown>): Promise<unknown> {
    let adapter: AccountKitAdapter<unknown>
    let raw: GuardContract<unknown>
    let authenticated: boolean
    try {
      adapter = (await ctx.containerResolver.make(
        'masquerade.native'
      )) as AccountKitAdapter<unknown>
      raw = ctx.auth.use(adapter.managedGuard.name as never) as GuardContract<unknown>
      authenticated = await raw.check()
    } catch {
      throw new E_MASQUERADE_UNAVAILABLE()
    }
    if (!authenticated) return next()
    try {
      const user = raw.user
      if (!user) throw new E_MASQUERADE_UNAVAILABLE()
      const account = await adapter.provider.createUserForGuard(user)
      const { id: actorId, incarnation } = resolveAccountOwner(
        adapter.authority.incarnation,
        user,
        account.getId()
      )
      const runtime = await resolveRuntime(ctx)
      if (
        await runtime.activeMode({
          namespace: adapter.authority.namespace,
          actorId,
          actorIncarnation: incarnation,
        })
      )
        throw new E_MASQUERADE_ACTION_BLOCKED('sensitive')
    } catch (error) {
      if (error instanceof MasqueradeRequestException) throw error
      throw new E_MASQUERADE_UNAVAILABLE()
    }
    return next()
  }
}

/**
 * Global blocker for Account Kit's registered managed routes.
 *
 * @example
 * ```ts
 * import { AccountKitBlocker } from '@kevinjohn/adonisjs-masquerade/account-kit/middleware'
 * import router from '@adonisjs/core/services/router'
 *
 * router.use([
 *   () => import('@adonisjs/auth/initialize_auth_middleware'),
 *   async () => ({ default: AccountKitBlocker }),
 * ])
 * ```
 */
export class AccountKitBlocker extends AccountKitAccountBlocker {
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

export default AccountKitBlocker
