import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import { AccountAdmission, admissionMiddleware } from '@kevinjohn/adonisjs-account-kit/admission'
import { managedGuard } from '#services/account_kit_guard'

/**
 * Gate every control and business route the fixture inherits from native-session, including the
 * /support workspace and its JSON client, before Masquerade context selection.
 */
export default class AccountKitAdmissionMiddleware {
  async handle(context: HttpContext, next: () => Promise<unknown>) {
    const path = context.request.url().split('?', 1)[0]
    const gated =
      path === '/masquerade' ||
      path.startsWith('/masquerade/') ||
      path === '/api/masquerade' ||
      path.startsWith('/api/masquerade/') ||
      path === '/business' ||
      path.startsWith('/business/') ||
      path === '/support' ||
      path.startsWith('/support/') ||
      path === '/dashboard' ||
      path === '/api/support/customer' ||
      path === '/api/business'
    if (!gated) return next()
    const admit = admissionMiddleware({
      admission: () => app.container.make(AccountAdmission),
      guard: managedGuard,
    })
    return admit(context, next)
  }
}
