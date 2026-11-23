import type { HttpContext } from '@adonisjs/core/http'
import { MasqueradeError } from '../src/errors.js'
import { createUnavailableError } from '../src/error_helpers.js'
import { accountOwner } from './account_owner.js'
import { runtimeFor } from '../src/integration/runtime.js'
import { classifyAccountKitRoute } from '../src/integration/account_kit_route_classification.js'
import type { AccountKitAdapter } from './main.js'
import type { GuardContract } from '@adonisjs/auth/types'
import { assertManagedRouteRegistration } from './route_validation.js'
import { managedRegistration } from './registration.js'

/** Opt-in blocker for host-owned native account routes. Keep logout and CSRF outside its group. */
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
      throw createUnavailableError()
    }
    if (!authenticated) return next()
    try {
      const user = raw.user
      if (!user) throw createUnavailableError()
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
      throw createUnavailableError()
    }
    return next()
  }
}

/** Global blocker for Account Kit's registered managed routes. */
export class AccountKitBlocker extends AccountKitAccountBlocker {
  /**
   * Block managed `accountKit.*` routes while a mode is active, except logout and CSRF, after
   * checking the managed route registration. Other routes pass through.
   */
  async handle(ctx: HttpContext, next: () => Promise<unknown>): Promise<unknown> {
    if (classifyAccountKitRoute(ctx.route?.name) !== 'managed') return next()
    const router = await ctx.containerResolver.make('router')
    assertManagedRouteRegistration(router.toJSON(), await managedRegistration(router))
    return super.handle(ctx, next)
  }
}

export default AccountKitBlocker
