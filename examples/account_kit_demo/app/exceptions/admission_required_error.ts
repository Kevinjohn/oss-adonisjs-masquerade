import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'

const admissionCode = 'E_ACCOUNT_KIT_ADMISSION_REQUIRED'
const admissionMessage = 'Account access requires approval.'

/** Keep JSON stable while the host exception handler retains HTML recovery pages. */
export default class AdmissionRequiredError extends Exception {
  constructor() {
    super(admissionMessage, { status: 403, code: admissionCode })
  }

  handle(_error: unknown, ctx: HttpContext): void {
    ctx.response.status(403).json({ errors: [{ code: admissionCode, message: admissionMessage }] })
  }
}
