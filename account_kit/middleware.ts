import type { HttpContext } from '@adonisjs/core/http'
import { MasqueradeError } from '../src/errors.js'
import { unavailable } from '../src/error_helpers.js'
import { accountOwner } from './account_owner.js'
import { runtimeFor } from '../src/integration/runtime.js'
import type { AccountKitAdapter } from './main.js'
import type { GuardContract } from '@adonisjs/auth/types'
import { assertManagedRouteRegistration } from './route_validation.js'
import { managedRegistration } from './registration.js'

/** Opt-in blocker for host-owned native account routes. Keep logout and CSRF outside its group. */
export class AccountKitAccountBlocker {
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
      throw unavailable()
    }
    if (!authenticated) return next()
    try {
      const user = raw.user
      if (!user) throw unavailable()
      const account = await adapter.provider.createUserForGuard(user)
      const { id: actorId, incarnation } = accountOwner(
        adapter.authority.incarnation,
        user,
        account.getId()
      )
      const runtime = await runtimeFor(ctx)
      if (
        await runtime.activeMode({
          namespace: adapter.authority.namespace,
          actorId,
          actorIncarnation: incarnation,
        })
      )
        throw new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED', { blockedBy: 'sensitive' })
    } catch (error) {
      if (error instanceof MasqueradeError) throw error
      throw unavailable()
    }
    return next()
  }
}

/** Global blocker for Account Kit's registered managed routes. */
export class AccountKitBlocker extends AccountKitAccountBlocker {
  async handle(ctx: HttpContext, next: () => Promise<unknown>): Promise<unknown> {
    const name = ctx.route?.name
    if (
      !name?.startsWith('accountKit.') ||
      name === 'accountKit.account.logout' ||
      name === 'accountKit.auth.csrf'
    )
      return next()
    const router = await ctx.containerResolver.make('router')
    assertManagedRouteRegistration(router.toJSON(), await managedRegistration(router))
    return super.handle(ctx, next)
  }
}

export default AccountKitBlocker
