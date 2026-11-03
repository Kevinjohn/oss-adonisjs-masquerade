import { defineConfig } from 'adonisjs-masquerade'
import { sessionAuthority } from 'adonisjs-masquerade/native'
import { LucidControlStore } from 'adonisjs-masquerade/stores/lucid'
import app from '@adonisjs/core/services/app'
import { Database } from '@adonisjs/lucid/database'
import type User from '#models/user'
import { userProvider } from '#services/web_guard'

const native = sessionAuthority({
  namespace: 'inertia-react-example',
  guard: 'web',
  provider: userProvider,
  incarnation: 'id',
  securityStamp: (user: User) => user.securityStamp,
  isActive: (user: User) => Boolean(user.active),
})

const config = defineConfig({
  authority: native.authority,
  policy: {
    canMasquerade: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) && Boolean(target.user.active),
    canEdit: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) && Boolean(target.user.active),
    canUseRequest: ({ actor, target }) => Boolean(actor.user.active) && Boolean(target.user.active),
  },
  store: async () => {
    const database = await app.container.make(Database)
    const store = new LucidControlStore(database.connection())
    if (process.env.NODE_ENV !== 'test') return store

    const { withFixtureControlStore } = await import('#services/masquerade_fixture_boundary')
    return withFixtureControlStore(store)
  },
  contextEnforcement:
    process.env.MASQUERADE_CONTEXT_ENFORCEMENT === 'report' ? 'report' : 'enforce',
  retention: 'host-managed',
})

export const nativeAdapter = native
export default config
