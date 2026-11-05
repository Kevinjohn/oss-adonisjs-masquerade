import { defineConfig } from '@kevinjohn/adonisjs-masquerade'
import { sessionAuthority } from '@kevinjohn/adonisjs-masquerade/native'
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
import app from '@adonisjs/core/services/app'
import { Database } from '@adonisjs/lucid/database'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { userProvider } from '#services/web_guard'

const native = sessionAuthority({
  namespace: 'inertia-vue-example',
  guard: 'web',
  provider: userProvider,
  incarnation: 'id',
  securityStamp: (user: User) => user.securityStamp,
  isActive: (user: User) => Boolean(user.active),
})

export const nativeAdapter = native

export default defineConfig({
  authority: native.authority,
  // The support form asks for a reason; the server enforces it.
  reason: 'required',
  policy: {
    // Operators may support active customers, never another operator.
    canMasquerade: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) &&
      !target.user.masqueradeOperator &&
      Boolean(target.user.active),
    canEdit: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) &&
      !target.user.masqueradeOperator &&
      Boolean(target.user.active),
    canUseRequest: async ({ actor, target, request }) => {
      if (process.env.NODE_ENV === 'test') {
        const { areCustomerRequestsUnavailable } =
          await import('#services/masquerade_fixture_boundary')
        if (
          areCustomerRequestsUnavailable() &&
          (request as HttpContext).request.url() === '/support/customer'
        )
          throw new Error('fixture customer request unavailable')
      }
      return Boolean(actor.user.active) && Boolean(target.user.active)
    },
  },
  store: async () => {
    const database = await app.container.make(Database)
    const store = new LucidControlStore(database.connection())
    if (process.env.NODE_ENV !== 'test') return store
    const { withFixtureControlStore } = await import('#services/masquerade_fixture_boundary')
    return withFixtureControlStore(store)
  },
  contextEnforcement: 'enforce',
  retention: 'host-managed',
})
