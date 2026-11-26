import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

export default class SupportAccountController {
  async show(ctx: HttpContext) {
    ctx.response.header('Cache-Control', 'private, no-store')
    const operator = ctx.auth.use('web').getUserOrFail() as User
    return ctx.view.render('pages/support_account', { operator })
  }
}
