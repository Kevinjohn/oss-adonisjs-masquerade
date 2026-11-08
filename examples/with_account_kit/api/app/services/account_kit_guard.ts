import { createManagedGuard } from '@kevinjohn/adonisjs-account-kit/http'

export const managedGuard = createManagedGuard({
  strategy: 'access_tokens',
  name: 'api',
  async loadUser() {
    const { default: User } = await import('#models/user')
    return User
  },
})
