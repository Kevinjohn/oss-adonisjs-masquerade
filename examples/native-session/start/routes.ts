import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'

import './masquerade_control_routes.js'
import './token_control_routes.js'
import './demo_routes.js'
import './demo_json_routes.js'

if (process.env.NODE_ENV === 'test') {
  await import('./token_test_routes.js')
}

const controllers = {
  Session: () => import('#controllers/session_controller'),
  NewAccount: () => import('#controllers/new_account_controller'),
}

router.on('/').render('pages/home').as('home')

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])
    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])
  })
  .use(middleware.guest())

router
  .on('/dashboard')
  .render('pages/dashboard')
  .as('dashboard')
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/logout', [controllers.Session, 'destroy'])
  .as('logout')
  .use(middleware.auth({ guards: ['web'] }))
