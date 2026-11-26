/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import '#start/masquerade_control_routes'
import '#start/demo_routes'

const controllers = {
  Session: () => import('#controllers/session_controller'),
  NewAccount: () => import('#controllers/new_account_controller'),
}

router.on('/').renderInertia('home', {}).as('home')
router
  .get('/dashboard', ({ response }) => response.redirect().toPath('/support'))
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])
  })
  .use(middleware.guest())

router
  .group(() => {
    router.post('logout', [controllers.Session, 'destroy'])
  })
  .use(middleware.auth({ guards: ['web'] }))
