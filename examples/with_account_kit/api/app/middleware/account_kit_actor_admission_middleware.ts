import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import app from '@adonisjs/core/services/app'
import { AccountAdmission, admissionMiddleware } from '@kevinjohn/adonisjs-account-kit/admission'
import { managedGuard } from '#services/account_kit_guard'

const protectedPrefixes = ['masquerade.', 'business.']
const requireAdmission = admissionMiddleware({
  admission: () => app.container.make(AccountAdmission),
  guard: managedGuard,
})

/** Check the actor before Masquerade can read or invalidate their mode. */
export default class AccountKitActorAdmissionMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const name = ctx.route?.name
    if (!name || !protectedPrefixes.some((prefix) => name.startsWith(prefix))) {
      return next()
    }
    return requireAdmission(ctx, next)
  }
}
