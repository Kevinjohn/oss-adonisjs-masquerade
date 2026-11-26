import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'

import './demo_routes.js'
import './masquerade_control_routes.js'
import './account_kit_routes.js'

router.on('/').render('pages/home').as('home')
router.on('/login').render('pages/auth/login').as('session.create').use(middleware.guest())
router
  .on('/dashboard')
  .render('pages/dashboard')
  .as('dashboard')
  .use(middleware.auth({ guards: ['web_effective'] }))
router
  .get('/support/account', [() => import('#controllers/support_account_controller'), 'show'])
  .as('support.account')
  .use(middleware.auth({ guards: ['web'] }))
