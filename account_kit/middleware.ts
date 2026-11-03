import type { HttpContext } from '@adonisjs/core/http'
import { unavailable, MasqueradeError } from '../src/errors.js'
import { boundedString } from '../src/bounded_string.js'
import { runtimeFor } from '../src/integration/runtime.js'
import type { AccountKitAdapter } from './main.js'
import type { GuardContract } from '@adonisjs/auth/types'
import { assertManagedRouteRegistration } from './route_validation.js'
import { managedRegistration } from './registration.js'

export class AccountKitBlocker {
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
      const identifier = account.getId()
      if (
        typeof identifier !== 'string' &&
        typeof identifier !== 'bigint' &&
        !(typeof identifier === 'number' && Number.isSafeInteger(identifier))
      )
        throw unavailable()
      const actorId = String(identifier)
      const incarnation =
        adapter.authority.incarnation === 'id' ? actorId : adapter.authority.incarnation(user)
      if (!boundedString(actorId, 255) || !boundedString(incarnation, 128)) throw unavailable()
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

export default AccountKitBlocker
