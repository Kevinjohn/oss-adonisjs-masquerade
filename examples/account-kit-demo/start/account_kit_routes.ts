import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { registerManagedRoutes } from '@kevinjohn/adonisjs-account-kit/http'
import { sessionGuard } from '#services/account_kit_guard'
import { validateProfile } from '#validators/account_kit_profile'

registerManagedRoutes(router, {
  prefix: '/kit',
  enabled: ['authentication', 'emailPasswordManagement'],
  except: [
    'account.profile.show',
    'account.password.change',
    'auth.emailChange.inspect',
    'auth.emailChange.complete',
  ],
  extensions: { profile: { validate: validateProfile } },
  kit: () => app.container.make(AccountKit),
  guard: sessionGuard,
})
