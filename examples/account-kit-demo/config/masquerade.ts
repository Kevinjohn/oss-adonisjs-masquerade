import { defineConfig } from '@kevinjohn/adonisjs-masquerade'
import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit'
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import app from '@adonisjs/core/services/app'
import { Database } from '@adonisjs/lucid/database'
import { userProvider } from '#services/web_guard'
import { sessionGuard } from '#services/account_kit_guard'

export const nativeAdapter = accountKitAuthority({
  namespace: 'packed-account-kit-consumer',
  incarnation: 'id',
  kit: () => app.container.make(AccountKit),
  managedGuard: sessionGuard,
  provider: userProvider,
})

export default defineConfig({
  authority: nativeAdapter.authority,
  policy: {
    canMasquerade: async ({ actor, target }) => {
      // Operators may support active customers, never another operator.
      if (!actor.user.masqueradeOperator || target.user.masqueradeOperator) return false
      if (!target.user.active) return false
      const admission = await app.container.make(AccountAdmission)
      return admission.isAdmitted(target.id)
    },
    canEdit: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) && !target.user.masqueradeOperator,
    canUseRequest: ({ actor, target }) => Boolean(actor.user.active) && Boolean(target.user.active),
  },
  store: async () => {
    const database = await app.container.make(Database)
    return new LucidControlStore(database.connection())
  },
  contextEnforcement: 'enforce',
  retention: 'host-managed',
})
