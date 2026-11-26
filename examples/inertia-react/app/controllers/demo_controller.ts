import { preferenceValidator } from '#validators/preference'
import { supportControlValidator } from '#validators/support_control'
import User from '#models/user'
import { demoAccounts } from '#services/demo_accounts'
import { controlInput } from '#services/support_control_input'
import { Bouncer } from '@adonisjs/bouncer'
import { inject } from '@adonisjs/core'
import { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { MasqueradeRuntime } from '@kevinjohn/adonisjs-masquerade/masquerade_provider'

/** The raw workspace remains reachable when effective admission cannot succeed. */
@inject()
export default class DemoController {
  #context: HttpContext

  constructor(context: HttpContext = HttpContext.getOrFail()) {
    this.#context = context
  }

  async status({ auth, containerResolver, inertia }: HttpContext) {
    noStore(this.#context)
    const actor = auth.use('web').getUserOrFail() as User
    const runtime = (await containerResolver.make('masquerade.runtime')) as MasqueradeRuntime<User>
    const mode = await runtime.service.status(this.#context)
    const customerEmails = demoAccounts
      .filter((account) => !account.masqueradeOperator)
      .map((account) => account.email)
    const customers = actor.masqueradeOperator
      ? await User.query().whereIn('email', customerEmails).where('active', true)
      : []
    const target = mode.isMasquerading ? await User.find(mode.targetId) : null
    prepareHistory(this.#context)
    return inertia.render('support/workspace', {
      actor: label(actor),
      operator: Boolean(actor.masqueradeOperator),
      mode,
      customers: customers.map((customer) => label(customer)),
      target: target ? label(target) : null,
      beforeDeadline: mode.isMasquerading && Date.parse(mode.expiresAt) > Date.now(),
      targetAvailable: Boolean(target?.active),
    })
  }

  async start({ containerResolver, request, response, session }: HttpContext) {
    const body = await request.validateUsing(supportControlValidator, { data: request.body() })
    noStore(this.#context)
    const runtime = (await containerResolver.make('masquerade.runtime')) as MasqueradeRuntime<User>
    await runtime.service.start(
      this.#context,
      controlInput(body, request.header('X-Masquerade-Context'), 'start')
    )
    session.flash('supportClearHistory', true)
    return response.redirect().toPath('/support/customer')
  }

  async stop({ containerResolver, request, response, session }: HttpContext) {
    const body = await request.validateUsing(supportControlValidator, { data: request.body() })
    noStore(this.#context)
    const runtime = (await containerResolver.make('masquerade.runtime')) as MasqueradeRuntime<User>
    await runtime.service.stop(
      this.#context,
      controlInput(body, request.header('X-Masquerade-Context'), 'stop')
    )
    session.flash('supportClearHistory', true)
    return response.redirect().toPath('/support')
  }

  async customer({ auth, containerResolver, inertia, response }: HttpContext) {
    noStore(this.#context)
    const runtime = (await containerResolver.make('masquerade.runtime')) as MasqueradeRuntime<User>
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
    return inertia.render('support/customer', {
      actor: label(actor),
      customer: label(customer),
      mode,
      emailUpdates: Boolean(preference?.email_updates),
      canEdit: await customerBouncer(this.#context).allows(
        Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
      ),
    })
  }

  async preference({ auth, containerResolver, request, response, session }: HttpContext) {
    const [validationError, input] = await request.tryValidateUsing(preferenceValidator)
    noStore(this.#context)
    const runtime = (await containerResolver.make('masquerade.runtime')) as MasqueradeRuntime<User>
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

function label(user: User) {
  return { id: user.id, fullName: user.fullName, email: user.email }
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
