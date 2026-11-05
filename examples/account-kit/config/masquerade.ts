import { defineConfig } from '@kevinjohn/adonisjs-masquerade'
import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit'
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import app from '@adonisjs/core/services/app'
import { Database } from '@adonisjs/lucid/database'
import { accessTokenUserProvider, userProvider } from '#services/web_guard'
import { sessionGuard, tokenGuard } from '#services/account_kit_guard'

const token = process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens'
const base = {
  namespace: 'packed-account-kit-consumer',
  incarnation: 'id' as const,
  kit: () => app.container.make(AccountKit),
}
export const nativeAdapter = token
  ? accountKitAuthority({
      ...base,
      managedGuard: tokenGuard,
      provider: accessTokenUserProvider,
      ability: 'masquerade',
    })
  : accountKitAuthority({ ...base, managedGuard: sessionGuard, provider: userProvider })

export default defineConfig({
  authority: nativeAdapter.authority,
  policy: {
    canMasquerade: async ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) &&
      !target.user.masqueradeOperator &&
      Boolean(target.user.active) &&
      (await (await app.container.make(AccountAdmission)).isAdmitted(target.id)),
    canEdit: ({ actor, target }) =>
      Boolean(actor.user.masqueradeOperator) && !target.user.masqueradeOperator,
    canUseRequest: ({ actor, target }) => Boolean(actor.user.active) && Boolean(target.user.active),
  },
  store: async () => new LucidControlStore((await app.container.make(Database)).connection()),
  contextEnforcement: 'enforce',
  retention: 'host-managed',
})
