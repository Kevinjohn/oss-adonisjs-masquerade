import { createManagedGuard } from '@kevinjohn/adonisjs-account-kit/http'

async function loadUser() {
  const module = await import('#models/user')
  return module.default
}

export const sessionGuard = createManagedGuard({ strategy: 'session', name: 'web', loadUser })
