import { tokensUserProvider } from '@adonisjs/auth/access_tokens'

/** Reuse this exact provider instance in the raw token guard and Account Kit authority. */
export const accessTokenUserProvider = tokensUserProvider({
  model: () => import('#models/user'),
  tokens: 'accessTokens',
})
