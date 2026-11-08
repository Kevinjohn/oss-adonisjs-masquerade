import { sessionUserProvider } from '@adonisjs/auth/session'

/** Reuse this exact provider instance in the raw session guard and native authority. */
export const userProvider = sessionUserProvider({
  model: () => import('#models/user'),
})
