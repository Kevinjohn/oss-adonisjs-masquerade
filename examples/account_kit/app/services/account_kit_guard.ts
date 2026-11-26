import { createManagedGuard } from '@kevinjohn/adonisjs-account-kit/http'

const loadUser = async () => (await import('#models/user')).default
export const tokenGuard = createManagedGuard({ strategy: 'access_tokens', name: 'api', loadUser })
export const sessionGuard = createManagedGuard({ strategy: 'session', name: 'web', loadUser })
export const managedGuard =
  process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens' ? tokenGuard : sessionGuard
