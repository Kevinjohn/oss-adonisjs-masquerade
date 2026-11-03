import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import { Exception } from '@adonisjs/core/exceptions'

const gated = ['/dashboard', '/support', '/masquerade', '/api/masquerade']
const admissionCode = 'E_ACCOUNT_KIT_ADMISSION_REQUIRED'
const admissionMessage = 'Account access requires approval.'

/** Keep JSON stable while the host exception handler retains HTML recovery pages. */
class AdmissionRequiredError extends Exception {
  constructor() {
    super(admissionMessage, { status: 403, code: admissionCode })
  }

  handle(_error: unknown, ctx: HttpContext): void {
    ctx.response.status(403).json({ errors: [{ code: admissionCode, message: admissionMessage }] })
  }
}

/** Admit the raw signed-in operator before context selection can query modes or events. */
export default class AccountKitAdmissionMiddleware {
  async handle(ctx: HttpContext, next: () => Promise<unknown>) {
    const path = ctx.request.url().split('?', 1)[0]
    if (!gated.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return next()
    if (!(await ctx.auth.use('web').check())) return next()
    const operator = ctx.auth.use('web').getUserOrFail()
    const admission = await app.container.make(AccountAdmission)
    if (!(await admission.isAdmitted(operator.id))) {
      throw new AdmissionRequiredError()
    }
    return next()
  }
}
