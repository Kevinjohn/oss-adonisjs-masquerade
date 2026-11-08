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

router.on('/').render('pages/home').as('home')

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])
    router.get('forgot-password', [controllers.PasswordResets, 'create'])
    router.post('forgot-password', [controllers.PasswordResets, 'store'])
  })
  .use([middleware.accountKitBlocker(), middleware.guest()])

router
  .get('verify-email/:token', [controllers.EmailVerifications, 'edit'])
  .use(middleware.accountKitBlocker())
router
  .post('verify-email/:token', [controllers.EmailVerifications, 'update'])
  .use(middleware.accountKitBlocker())
router
  .get('reset-password/:token', [controllers.PasswordResets, 'edit'])
  .use(middleware.accountKitBlocker())
router
  .post('reset-password/:token', [controllers.PasswordResets, 'update'])
  .use(middleware.accountKitBlocker())
router
  .get('confirm-email/:token', [controllers.EmailChanges, 'confirm'])
  .use(middleware.accountKitBlocker())
router
  .post('confirm-email/:token', [controllers.EmailChanges, 'complete'])
  .use(middleware.accountKitBlocker())

router.get('dashboard', [controllers.Dashboard, 'show']).as('dashboard').use(middleware.auth())

router
  .group(() => {
    router.post('email-verification', [controllers.EmailVerifications, 'store'])
    router.get('settings/profile', [controllers.Profile, 'edit'])
    router.post('settings/profile', [controllers.Profile, 'update'])
    router.get('settings/password', [controllers.Passwords, 'edit'])
    router.post('settings/password', [controllers.Passwords, 'update'])
    router.get('settings/email', [controllers.EmailChanges, 'edit'])
    router.post('settings/email', [controllers.EmailChanges, 'store'])
    router.post('settings/email/cancel', [controllers.EmailChanges, 'cancel'])
  })
  .use([middleware.accountKitBlocker(), middleware.auth({ guards: ['web'] })])

router
  .get('account', [controllers.Dashboard, 'protected'])
  .as('account')
  .use([middleware.auth(), middleware.verified()])

// Logout stays on the raw `web` guard, so an operator can still sign out while masquerading.
router
  .post('logout', [controllers.Session, 'destroy'])
  .as('session.destroy')
  .use(middleware.auth({ guards: ['web'] }))
