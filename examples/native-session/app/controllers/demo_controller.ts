import { preferenceValidator } from '#validators/preference'
import app from '@adonisjs/core/services/app'
import User from '#models/user'
import { demoAccounts } from '#services/demo_accounts'
import { Bouncer } from '@adonisjs/bouncer'
import { inject } from '@adonisjs/core'
import { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { masqueradeEdge } from '@kevinjohn/adonisjs-masquerade/http'
import MasqueradeFormController from '#controllers/masquerade_form_controller'
import type { MasqueradeFormFlash } from '#controllers/masquerade_form_controller'

/** Host-owned workspace and account query around the generated form controller. */
@inject()
export default class DemoController extends MasqueradeFormController {
  #context: HttpContext

  constructor(context: HttpContext = HttpContext.getOrFail()) {
    super(context)
    this.#context = context
  }

  override async status({
    auth,
    containerResolver,
    response,
    session,
    view,
  }: HttpContext): Promise<void> {
    noStore(this.#context)
    const actor = auth.use('web').getUserOrFail() as User
    const runtime = await containerResolver.make('masquerade.runtime')
    const mode = await runtime.service.status(this.#context)
    const masqueradeFlash = session.flashMessages.get('masquerade') as
      MasqueradeFormFlash | undefined
    const customerEmails = demoAccounts
      .filter((account) => !account.masqueradeOperator)
      .map((account) => account.email)
    const customers = actor.masqueradeOperator
      ? await User.query().whereIn('email', customerEmails).where('active', true)
      : []
    const target = mode.isMasquerading ? await User.find(mode.targetId) : null
    response.send(
      await view.render('pages/demo_workspace', {
        actor,
        operator: actor.masqueradeOperator,
        mode,
        masqueradeFlash,
        customers,
        target,
        beforeDeadline: mode.isMasquerading && Date.parse(mode.expiresAt) > (await now()),
        targetAvailable: Boolean(target?.active),
        expiresText: mode.isMasquerading ? formatDeadline(mode.expiresAt) : undefined,
      })
    )
  }

  override redirectAfterStart(): string {
    return '/support/customer'
  }

  override redirectAfterStop(): string {
    return '/support'
  }

  override errorPath(): string {
    return '/support'
  }

  async customer({ auth, response, view }: HttpContext) {
    noStore(this.#context)
    const mode = await masqueradeEdge.share(this.#context)
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= (await now())) {
      return response.redirect().toPath('/support')
    }
    const actor = auth.use('web').getUserOrFail() as User
    const customer = auth.user as User
    await customerBouncer(this.#context).authorize(
      Bouncer.ability((user: User) => user.active && user.id === customer.id)
    )
    const preference = await db.from('demo_preferences').where('user_id', customer.id).first()
    return view.render('pages/demo_customer', {
      actor,
      customer,
      mode,
      expiresText: formatDeadline(mode.expiresAt),
      emailUpdates: Boolean(preference?.email_updates),
      canEdit: await customerBouncer(this.#context).allows(
        Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
      ),
    })
  }

  async preference({ auth, request, response, session }: HttpContext) {
    const [validationError, input] = await request.tryValidateUsing(preferenceValidator)
    noStore(this.#context)
    const mode = await masqueradeEdge.share(this.#context)
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= (await now())) {
      return response.redirect().toPath('/support')
    }
    const customer = auth.user as User
    await customerBouncer(this.#context).authorize(
      Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
    )
    if (validationError) {
      return response.badRequest('Choose on or off for email updates.')
    }
    await db
      .table('demo_preferences')
      .insert({ user_id: customer.id, email_updates: input!.emailUpdates === '1' })
      .onConflict('user_id')
      .merge()
    session.flash('success', 'Customer email preference saved.')
    return response.redirect().toPath('/support/customer')
  }

  async sensitive({ response }: HttpContext) {
    // The sensitive marker rejects an active mode before this handler runs.
    return response.forbidden('Sensitive account actions are unavailable in support mode.')
  }
}

function customerBouncer({ auth }: HttpContext) {
  return new Bouncer<User>(() => (auth.user as User | undefined) ?? null)
}

function noStore({ response }: HttpContext) {
  response.header('Cache-Control', 'private, no-store')
  response.vary(['Accept', 'X-Masquerade-Context'])
}

async function now() {
  if (app.inTest) {
    const { masqueradeNow } = await import('#services/masquerade_fixture_boundary')
    return masqueradeNow()
  }
  return Date.now()
}

function formatDeadline(value: string): string {
  return `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))} UTC`
}
