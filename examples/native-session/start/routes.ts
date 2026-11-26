import app from '@adonisjs/core/services/app'
import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'

import '#start/masquerade_control_routes'
import '#start/token_control_routes'
import '#start/demo_routes'
import '#start/demo_json_routes'

if (app.inTest) {
  await import('#start/token_test_routes')
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
