import User from '#models/user'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class SessionController {
  async create({ inertia, session }: HttpContext) {
    if (session.flashMessages.get('supportClearHistory')) inertia.clearHistory()
    return inertia.render('auth/login', {})
  }

  async store({ request, auth, response, session }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    let user: User
    try {
      user = await User.verifyCredentials(email, password)
    } catch (error) {
      if ((error as { code?: string }).code !== 'E_INVALID_CREDENTIALS') throw error
      session.flash('error', 'Email or password did not match.')
      return response.redirect().toPath('/login')
    }

    await auth.use('web').login(user)
    response.redirect().toPath('/support')
  }

  async destroy({ auth, response, session }: HttpContext) {
    await auth.use('web').logout()
    session.flash('supportClearHistory', true)
    response.redirect().toPath('/login')
  }
}
