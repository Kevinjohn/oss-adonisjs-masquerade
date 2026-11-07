import { createManagedGuard } from '@kevinjohn/adonisjs-account-kit/http'

/**
 * Account Kit's view of the `web` session guard. Masquerade's Account Kit adapter uses it to
 * check the operator's session against Account Kit's credential revision.
 */
export const managedGuard = createManagedGuard({ strategy: 'session', name: 'web', loadUser })

async function loadUser() {
  const { default: User } = await import('#models/user')
  return User
}
