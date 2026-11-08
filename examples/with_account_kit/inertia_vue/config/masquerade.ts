import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { defineConfig } from '@kevinjohn/adonisjs-masquerade'
import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit'
import type User from '#models/user'
import { managedGuard } from '#services/account_kit_guard'
import { isMasqueradeOperator } from '#services/masquerade_operators'
import { masqueradeStore } from '#services/masquerade_store'
import { userProvider } from '#services/masquerade_user_provider'

/**
 * Account Kit owns the account state. A missing, restricted or inactive account cannot be a
 * target, and a credential change on either account ends an active mode. Account IDs are never
 * reused, so the ID is the account's incarnation.
 */
const nativeAdapter = accountKitAuthority<User>({
  namespace: 'starter',
  incarnation: 'id',
  kit: () => app.container.make(AccountKit),
  managedGuard,
  provider: userProvider,
})

export { nativeAdapter }

/** Operators may act for any other account, never for another operator. */
function operatorPair({ actor, target }: { actor: { user: User }; target: { user: User } }) {
  return isMasqueradeOperator(actor.user) && !isMasqueradeOperator(target.user)
}

export default defineConfig<User, HttpContext>({
  authority: nativeAdapter.authority,
  policy: {
    async canMasquerade(pair) {
      return operatorPair(pair)
    },
    // An operator may choose "Can edit" when starting. Routes still need allowMutation().
    async canEdit(pair) {
      return operatorPair(pair)
    },
  },
  store: async () => masqueradeStore,
  contextEnforcement: 'report',
  // A start reason is optional. Use 'required' when every start must be justified in the audit.
  reason: 'optional',
  retention: 'host-managed',
})
