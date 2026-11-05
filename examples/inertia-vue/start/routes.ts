/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'
import './masquerade_control_routes.js'
import './demo_routes.js'

router.on('/').renderInertia('home', {}).as('home')

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
  .renderInertia('dashboard', {})
  .as('dashboard')
  .use(middleware.auth({ guards: ['web_effective'] }))

router.post('logout', [controllers.Session, 'destroy']).use(middleware.auth({ guards: ['web'] }))
