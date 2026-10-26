import { defineConfig } from 'adonisjs-masquerade'
import {
  accessTokensAuthority,
  nativeAuthorities,
  sessionAuthority,
  stampFrom,
} from 'adonisjs-masquerade/native'
import { LucidControlStore } from 'adonisjs-masquerade/stores/lucid'
import app from '@adonisjs/core/services/app'
import { Database } from '@adonisjs/lucid/database'
import type User from '#models/user'
import { accessTokenUserProvider, userProvider } from '#services/web_guard'
import { shouldThrowFromAuthorityCallbacks } from '#services/masquerade_test_boundary'

const securityStamp = stampFrom<User>((user) => {
  if (shouldThrowFromAuthorityCallbacks()) throw new Error('Test security-stamp callback fault')
  return [user.password, user.masqueradeOperator, user.active, user.securityStamp]
})

const native = sessionAuthority({
  namespace: 'native-session-fixture',
  guard: 'web',
  provider: userProvider,
  incarnation: 'id',
  securityStamp,
  isActive: (user: User) => Boolean(user.active),
})

const tokenNative = accessTokensAuthority({
  authority: native.authority,
  guard: 'api',
  provider: accessTokenUserProvider,
  ability: 'masquerade',
})
const authorities = nativeAuthorities(native, [tokenNative])
const tokenOnlyNative = accessTokensAuthority({
  namespace: 'native-token-only-fixture',
  guard: 'api',
  provider: accessTokenUserProvider,
  ability: 'masquerade',
  incarnation: 'id',
  securityStamp,
  isActive: (user: User) => Boolean(user.active),
})
const tokenOnly = process.env.MASQUERADE_TRANSPORT === 'tokens'
const runtimeAdapter = tokenOnly ? tokenOnlyNative : authorities

const config = defineConfig({
  authority: runtimeAdapter.authority,
  policy: {
    canMasquerade: ({ actor, target }) => {
      if (shouldThrowFromAuthorityCallbacks()) throw new Error('Test policy callback fault')
      return Boolean(actor.user.masqueradeOperator) && Boolean(target.user.active)
    },
    canEdit: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) && Boolean(target.user.active),
    canUseRequest: ({ actor, target }) => {
      if (shouldThrowFromAuthorityCallbacks()) throw new Error('Test request-policy callback fault')
      return Boolean(actor.user.active) && Boolean(target.user.active)
    },
  },
  store: async () => {
    const database = await app.container.make(Database)
    const store = new LucidControlStore(database.connection())
    if (process.env.NODE_ENV !== 'test') return store

    const { withFixtureControlStore } = await import('#services/masquerade_test_boundary')
    return withFixtureControlStore(store)
  },
  contextEnforcement:
    process.env.MASQUERADE_CONTEXT_ENFORCEMENT === 'report' ? 'report' : 'enforce',
  retention: 'host-managed',
})

export const nativeAdapter = runtimeAdapter
export const tokenNativeAdapter = tokenNative
export default config
