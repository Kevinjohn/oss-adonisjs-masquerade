import type { AccountKitAuthorityOptions } from '../../account_kit/main.js'
import type { SessionUserProviderContract } from '@adonisjs/auth/types/session'
import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'

type User = { id: number }

const provider = {
  createUserForGuard: async (user: User) => ({ getId: () => user.id, getOriginal: () => user }),
  findById: async (_id: string) => null,
}
const kit = () => ({
  authentication: {
    inspectAccountAccess: async () => ({ account: { id: 1, active: true }, revision: null }),
    current: async () => ({ id: 1 }),
  },
})
const sessionGuard = {
  name: 'web',
  strategy: 'session' as const,
  current: async () => ({ userId: 1, revision: null }),
}
const tokenGuard = {
  name: 'api',
  strategy: 'access_tokens' as const,
  current: async () => ({ userId: 1, tokenId: 1 }),
}
const base = { namespace: 'users', incarnation: 'id' as const, provider, kit }
declare const nativeSessionProvider: SessionUserProviderContract<User>
declare const nativeTokenProvider: AccessTokensUserProviderContract<User>

const session = { ...base, managedGuard: sessionGuard } satisfies AccountKitAuthorityOptions<User>
const token = {
  ...base,
  managedGuard: tokenGuard,
  ability: 'masquerade',
} satisfies AccountKitAuthorityOptions<User>
const nativeSession = {
  ...base,
  provider: nativeSessionProvider,
  managedGuard: sessionGuard,
} satisfies AccountKitAuthorityOptions<User>
const nativeToken = {
  ...base,
  provider: nativeTokenProvider,
  managedGuard: tokenGuard,
  ability: 'masquerade',
} satisfies AccountKitAuthorityOptions<User>

// @ts-expect-error Session strategies cannot configure an access-token ability.
const sessionWithAbility: AccountKitAuthorityOptions<User> = {
  ...base,
  managedGuard: sessionGuard,
  ability: 'masquerade',
}
// @ts-expect-error Token strategies require an explicit ability.
const tokenWithoutAbility: AccountKitAuthorityOptions<User> = { ...base, managedGuard: tokenGuard }

void [session, token, nativeSession, nativeToken, sessionWithAbility, tokenWithoutAbility]
