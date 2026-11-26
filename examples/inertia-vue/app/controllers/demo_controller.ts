import { supportCustomerValidator } from '#validators/support_customer'
import { preferenceValidator } from '#validators/preference'
import { supportControlValidator } from '#validators/support_control'
import app from '@adonisjs/core/services/app'
import User from '#models/user'
import { demoAccounts } from '#services/demo_accounts'
import { controlInput } from '#services/support_control_input'
import { Bouncer } from '@adonisjs/bouncer'
import { inject } from '@adonisjs/core'
import { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { MasqueradeRuntime } from '@kevinjohn/adonisjs-masquerade/masquerade_provider'

@inject()
export default class DemoController {
  #context: HttpContext

  constructor(context: HttpContext = HttpContext.getOrFail()) {
    this.#context = context
  }

  async workspace({ auth, inertia }: HttpContext) {
    noStore(this.#context)
    const actor = auth.use('web').getUserOrFail() as User
    const runtime = await getRuntime(this.#context)
    const status = await runtime.service.status(this.#context)
    const customers = actor.masqueradeOperator
      ? await User.query()
          .whereIn(
            'email',
            demoAccounts.filter((account) => !account.masqueradeOperator).map(({ email }) => email)
          )
          .where('active', true)
      : []
    const target = status.isMasquerading ? await User.find(status.targetId) : null
    const mode = publicMode(status)
    prepareHistory(this.#context)
    return inertia.render('support/workspace', {
      actor: label(actor),
      operator: Boolean(actor.masqueradeOperator),
      mode,
      customers: customers.map(label),
      target: target ? label(target) : null,
      beforeDeadline: mode.isMasquerading && Date.parse(mode.expiresAt!) > Date.now(),
      targetAvailable: Boolean(target?.active),
    })
  }

  async identity({ response }: HttpContext) {
    noStore(this.#context)
    const runtime = await getRuntime(this.#context)
    const status = await runtime.service.status(this.#context)
    return response.json({ mode: publicMode(status) })
  }

  async start({ request, response, session }: HttpContext) {
    const body = await request.validateUsing(supportControlValidator, { data: request.body() })
    noStore(this.#context)
    const runtime = await getRuntime(this.#context)
    await runtime.service.start(
      this.#context,
      controlInput(body, request.header('X-Masquerade-Context'), 'start')
    )
    session.flash('supportClearHistory', true)
    return response.redirect().toPath('/support/customer')
  }

  async stop({ request, response, session }: HttpContext) {
    const body = await request.validateUsing(supportControlValidator, { data: request.body() })
    noStore(this.#context)
    const runtime = await getRuntime(this.#context)
    await runtime.service.stop(
      this.#context,
      controlInput(body, request.header('X-Masquerade-Context'), 'stop')
    )
    session.flash('supportClearHistory', true)
    return response.redirect().toPath('/support')
  }

  async customer({ auth, inertia, request, response }: HttpContext) {
    const { delayMs: requestedDelay = 0 } = await request.validateUsing(supportCustomerValidator)
    noStore(this.#context)
    const runtime = await getRuntime(this.#context)
    const admitted = await runtime.admit(this.#context)
    const mode = admitted.view
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= Date.now()) {
      return response.redirect().toPath('/support')
    }
    const actor = auth.use('web').getUserOrFail() as User
    const customer = auth.user as User
    await customerBouncer(this.#context).authorize(
      Bouncer.ability((user: User) => user.active && user.id === customer.id)
    )
    const preference = await db.from('demo_preferences').where('user_id', customer.id).first()
    prepareHistory(this.#context)
    const props = {
      actor: label(actor),
      customer: label(customer),
      mode: {
        isMasquerading: true as const,
        access: mode.access,
        targetId: mode.targetId,
        expiresAt: mode.expiresAt,
        contextToken: mode.contextToken,
      },
      emailUpdates: Boolean(preference?.email_updates),
      canEdit: await customerBouncer(this.#context).allows(
        Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
      ),
    }
    const delayMs = app.inTest ? requestedDelay : 0
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 3000)))
    }
    return inertia.render('support/customer', props)
  }

  async preference({ auth, request, response, session }: HttpContext) {
    const [validationError, input] = await request.tryValidateUsing(preferenceValidator)
    noStore(this.#context)
    const runtime = await getRuntime(this.#context)
    const admitted = await runtime.admit(this.#context)
    if (!admitted.view.isMasquerading || Date.parse(admitted.view.expiresAt) <= Date.now()) {
      return response.redirect().toPath('/support')
    }
    const customer = auth.user as User
    await customerBouncer(this.#context).authorize(
      Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
    )
    if (validationError) return response.badRequest('Choose on or off for email updates.')
    await db
      .table('demo_preferences')
      .insert({ user_id: customer.id, email_updates: input!.emailUpdates === '1' })
      .onConflict('user_id')
      .merge()
    session.flash('success', 'Customer email preference saved.')
    return response.redirect().toPath('/support/customer')
  }

  async sensitive({ response }: HttpContext) {
    return response.forbidden('Sensitive account actions are unavailable in support mode.')
  }

  async recovery({ inertia, session }: HttpContext) {
    noStore(this.#context)
    const title = session.flashMessages.get('supportRecoveryTitle') as string | undefined
    const message = session.flashMessages.get('supportRecovery') as string | undefined
    prepareHistory(this.#context)
    return inertia.render('support/recovery', {
      title: title ?? 'Support action needs review',
      message: message ?? 'Check current support status before creating a new action.',
    })
  }
}

async function getRuntime({ containerResolver }: HttpContext) {
  return (await containerResolver.make('masquerade.runtime')) as MasqueradeRuntime<User>
}

function label(user: User) {
  return { id: user.id, fullName: user.fullName ?? user.email, email: user.email }
}

function publicMode(mode: Awaited<ReturnType<MasqueradeRuntime<User>['service']['status']>>) {
  return mode.isMasquerading
    ? {
        isMasquerading: true as const,
        access: mode.access,
        targetId: mode.targetId,
        expiresAt: mode.expiresAt,
        contextToken: mode.contextToken,
      }
    : { isMasquerading: false as const, contextToken: mode.contextToken }
}

function prepareHistory({ inertia, session }: HttpContext) {
  if (session.flashMessages.get('supportClearHistory')) inertia.clearHistory()
  inertia.encryptHistory()
}

function customerBouncer({ auth }: HttpContext) {
  return new Bouncer<User>(() => (auth.user as User | undefined) ?? null)
}

function noStore({ response }: HttpContext) {
  response.header('Cache-Control', 'private, no-store')
  response.vary(['Accept', 'X-Masquerade-Context'])
}
