import { NativeAdapter } from '../integration/native_adapter.ts'
import { MasqueradeRequestException } from '../errors.ts'
import { E_MASQUERADE_ACTION_BLOCKED, E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import type { HttpContext } from '@adonisjs/core/http'
import { resolveAccountOwner } from './account_owner.ts'
import { resolveRuntime } from '../integration/runtime.ts'
import type { AccountKitAdapter } from '../types.ts'
import type { GuardContract } from '@adonisjs/auth/types'

/**
 * Opt-in blocker for host-owned native account routes. Keep logout and CSRF outside its group.
 *
 * @example
 * ```ts
 * import type AccountKitAccountBlocker from '@kevinjohn/adonisjs-masquerade/account-kit/account_blocker_middleware'
 * import type { HttpContext, Router } from '@adonisjs/core/http'
 *
 * export function mountNativeAccountRoutes(
 *   router: Router,
 *   updateEmail: (ctx: HttpContext) => Promise<void>
 * ) {
 *   const middleware = router.named({
 *     accountKitAccountBlocker: () =>
 *       import('@kevinjohn/adonisjs-masquerade/account-kit/account_blocker_middleware') as Promise<{
 *         default: typeof AccountKitAccountBlocker
 *       }>,
 *   })
 *   router
 *     .group(() => {
 *       router.post('/account/email', updateEmail)
 *     })
 *     .use(middleware.accountKitAccountBlocker())
 * }
 * ```
 */
export default class AccountKitAccountBlocker {
  /** Refuse the route with `E_MASQUERADE_ACTION_BLOCKED` (`sensitive`) while a mode is active. */
  async handle(ctx: HttpContext, next: () => Promise<unknown>): Promise<unknown> {
    let adapter: AccountKitAdapter<unknown>
    let raw: GuardContract<unknown>
    let authenticated: boolean
    try {
      adapter = (await ctx.containerResolver.make(NativeAdapter)) as AccountKitAdapter<unknown>
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
