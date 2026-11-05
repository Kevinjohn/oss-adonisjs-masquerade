import app from '@adonisjs/core/services/app'
import env from '#start/env'
import {
  createActionUrls,
  createLucidAdapter,
  createLogNotifications,
  defineConfig,
} from '@kevinjohn/adonisjs-account-kit'

const strategy =
  process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens' ? 'access_tokens' : 'session'
const sessionManagement = process.env.ACCOUNT_KIT_SESSION_MANAGEMENT === 'true'
const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:3333'

export default defineConfig({
  users: createLucidAdapter(async () => (await import('#models/user')).default),
  enabled: [
    'registration',
    'emailVerification',
    'passwordReset',
    'emailPasswordManagement',
    ...(sessionManagement ? ['sessionManagement' as const] : []),
  ],
  ...(sessionManagement ? { sessionManagement: {} } : {}),
  registration: { availability: 'open' },
  authentication: {
    strategy,
    guard: strategy === 'session' ? 'web' : 'api',
    canAccess: async (user, trx) => {
      const row = await trx.from('users').select('active').where('id', user.id).first()
      return row?.active === true || row?.active === 1
    },
    ...(strategy === 'access_tokens' ? { tokenAbilities: ['*', 'masquerade'] } : {}),
  },
  limiterSecret: env.get('APP_KEY'),
  authorize: {
    invite: async () => false,
    manageInvitation: async () => false,
    listInvitations: async () => false,
  },
  urls: createActionUrls({
    backendOrigin: baseUrl,
    appFrontendUrl: baseUrl,
    environment: app.inTest ? 'test' : 'development',
    destinations: {
      passwordReset: 'reset-password',
      emailVerification: 'verify-email',
      invitation: 'invitation',
      emailChange: 'confirm-email',
    },
  }),
  notify: createLogNotifications({ brandName: 'Consumer fixture', environment: 'development' }),
})
