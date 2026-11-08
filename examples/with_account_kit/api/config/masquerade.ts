import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import { defineConfig } from '@kevinjohn/adonisjs-masquerade'
import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit'
import type User from '#models/user'
import { managedGuard } from '#services/account_kit_guard'
import { isMasqueradeOperator } from '#services/masquerade_operators'
import { masqueradeStore } from '#services/masquerade_store'
import { accessTokenUserProvider } from '#services/masquerade_user_provider'

/** Account Kit owns activity, restrictions and credential revisions. IDs are never reused. */
export const nativeAdapter = accountKitAuthority<User>({
  namespace: 'starter',
  incarnation: 'id',
  kit: () => app.container.make(AccountKit),
  managedGuard,
  provider: accessTokenUserProvider,
  ability: 'masquerade',
})

function operatorPair({ actor, target }: { actor: { user: User }; target: { user: User } }) {
  return isMasqueradeOperator(actor.user) && !isMasqueradeOperator(target.user)
}

export default defineConfig<User, HttpContext>({
  authority: nativeAdapter.authority,
  policy: {
    async canMasquerade(pair) {
      const admission = await app.container.make(AccountAdmission)
      return operatorPair(pair) && (await admission.isAdmitted(pair.target.id))
    },
    // Edit permission never overrides sensitive() or the need for allowMutation().
    async canEdit(pair) {
      return operatorPair(pair)
    },
  },
  store: async () => masqueradeStore,
  contextEnforcement: 'enforce',
  reason: 'optional',
  retention: 'host-managed',
})
