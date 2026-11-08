import type { HttpContext } from '@adonisjs/core/http'
import type { MasqueradeRuntime } from '@kevinjohn/adonisjs-masquerade/masquerade_provider'
import User from '#models/user'
import type { MasqueradeFormFlash } from '#controllers/masquerade_form_controller'
import { isMasqueradeOperator } from '#services/masquerade_operators'

/** The operator's own page, on the raw `web` guard: start and stop forms. */
export default class MasqueradeAccountsController {
  async index(ctx: HttpContext) {
    ctx.response.header('Cache-Control', 'private, no-store')
    const operator = ctx.auth.use('web').getUserOrFail()
    const runtime = (await ctx.containerResolver.make('masquerade.runtime')) as MasqueradeRuntime
    const mode = await runtime.service.status(ctx)
    const canMasquerade = isMasqueradeOperator(operator)
    const users = canMasquerade ? await User.query().orderBy('email') : []
    const target = mode.isMasquerading ? await User.find(mode.targetId) : null
    return ctx.inertia.render('masquerade/accounts', {
      operatorEmail: operator.email,
      canMasquerade,
      mode: mode.isMasquerading
        ? {
            isMasquerading: true as const,
            contextToken: mode.contextToken,
            targetId: mode.targetId,
            access: mode.access,
            expiresAt: mode.expiresAt,
          }
        : { isMasquerading: false as const, contextToken: mode.contextToken },
      accounts: users
        .filter((user) => !isMasqueradeOperator(user))
        .map((user) => ({ id: user.id, email: user.email })),
      targetEmail: target?.email ?? null,
      outcome: outcomeFrom(ctx.session.flashMessages.get('masquerade')) ?? null,
    })
  }
}

const errorMessages: Record<string, string> = {
  E_MASQUERADE_NOT_ALLOWED: 'You cannot act as that account.',
  E_MASQUERADE_ALREADY_ACTIVE: 'Stop the current masquerade first.',
  E_MASQUERADE_CONTEXT_CHANGED: 'This page was out of date. Try again.',
}

/** English copy for the form controller's flash message. */
function outcomeFrom(flash: unknown) {
  const message = flash as MasqueradeFormFlash | undefined
  if (!message) return undefined
  if (message.type === 'success')
    return {
      type: 'success' as const,
      message: message.action === 'started' ? 'Masquerade started.' : 'Masquerade stopped.',
    }
  return {
    type: 'error' as const,
    message: errorMessages[message.code] ?? 'Masquerade is not available right now. Try again.',
  }
}
