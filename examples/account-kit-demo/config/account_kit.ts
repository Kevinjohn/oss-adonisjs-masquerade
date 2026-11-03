import app from '@adonisjs/core/services/app'
import env from '#start/env'
import {
  createActionUrls,
  createLucidAdapter,
  createLogNotifications,
  defineConfig,
} from '@kevinjohn/adonisjs-account-kit'
import { mapProfileFields } from '#validators/account_kit_profile'

const baseUrl = env.get('APP_URL')
const loadUser = async () => {
  const module = await import('#models/user')
  return module.default
}

export default defineConfig({
  users: createLucidAdapter(loadUser, {
    mapRegistrationData: (data, user) => {
      user.fullName = mapProfileFields(data).fullName
    },
  }),
  enabled: ['emailVerification', 'emailPasswordManagement', 'sessionManagement'],
  sessionManagement: {},
  registration: { availability: 'closed', mapFields: mapProfileFields },
  authentication: {
    strategy: 'session',
    guard: 'web',
    canAccess: async (user, trx) => {
      const row = await trx.from('users').select('active').where('id', user.id).first()
      return row?.active === true || row?.active === 1
    },
  },
  limiterSecret: env.get('APP_KEY'),
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
  notify: createLogNotifications({ brandName: 'Support demo', environment: 'development' }),
  onCredentialsChangedTransaction: async () => {},
})
