import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { registerManagedRoutes } from '@kevinjohn/adonisjs-account-kit/http'
import { managedGuard } from '#services/account_kit_guard'

registerManagedRoutes(router, {
  prefix: '/kit',
  except: ['auth.methods'],
  enabled: [
    'authentication',
    'emailVerification',
    'passwordReset',
    'emailPasswordManagement',
    ...(process.env.ACCOUNT_KIT_SESSION_MANAGEMENT === 'true'
      ? ['sessionManagement' as const]
      : []),
  ],
  kit: () => app.container.make(AccountKit),
  guard: managedGuard,
})
