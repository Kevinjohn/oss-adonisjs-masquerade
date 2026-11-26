import { preferenceValidator } from '#validators/preference'
import app from '@adonisjs/core/services/app'
import User from '#models/user'
import { demoAccounts } from '#services/demo_accounts'
import { Bouncer } from '@adonisjs/bouncer'
import { inject } from '@adonisjs/core'
import { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { masqueradeEdge } from '@kevinjohn/adonisjs-masquerade/http'

/** Host-owned JSON views of the existing fictional support workflow. */
@inject()
export default class DemoJsonController {
  #context: HttpContext

  constructor(context: HttpContext = HttpContext.getOrFail()) {
    this.#context = context
  }

  async shell({ auth, view }: HttpContext) {
    noStore(this.#context)
    const actor = auth.use('web').getUserOrFail() as User
    const emails = demoAccounts.filter((account) => !account.masqueradeOperator).map((a) => a.email)
    const customers = actor.masqueradeOperator
      ? await User.query().whereIn('email', emails).where('active', true)
      : []
    return view.render('pages/demo_json', {
      actor,
      customers: customers.map(({ id, fullName, email }) => ({ id, fullName, email })),
    })
  }

  async customer({ auth }: HttpContext) {
    noStore(this.#context)
    const mode = await masqueradeEdge.share(this.#context)
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= (await now())) {
      return changedContext(this.#context)
    }
    const actor = auth.use('web').getUserOrFail() as User
    const customer = auth.user as User
    await customerBouncer(this.#context).authorize(
      Bouncer.ability((user: User) => user.active && user.id === customer.id)
    )
    const preference = await db.from('demo_preferences').where('user_id', customer.id).first()
    return {
      actor: { id: actor.id, email: actor.email },
      customer: { id: customer.id, fullName: customer.fullName, email: customer.email },
      mode: { contextToken: mode.contextToken, expiresAt: mode.expiresAt, access: mode.access },
      emailUpdates: Boolean(preference?.email_updates),
      canEdit: Boolean(
        await customerBouncer(this.#context).allows(
          Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
        )
      ),
    }
  }

  async preference({ auth, request, response }: HttpContext) {
    const [validationError, input] = await request.tryValidateUsing(preferenceValidator)
    noStore(this.#context)
    const mode = await masqueradeEdge.share(this.#context)
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= (await now())) {
      return changedContext(this.#context)
    }
    const customer = auth.user as User
    await customerBouncer(this.#context).authorize(
      Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
    )
    if (validationError) {
      return response.unprocessableEntity({
        code: 'E_MASQUERADE_INVALID_INPUT',
        message: 'Choose on or off for email updates.',
      })
    }
    await db
      .table('demo_preferences')
      .insert({ user_id: customer.id, email_updates: input!.emailUpdates === '1' })
      .onConflict('user_id')
      .merge()
    return { emailUpdates: input!.emailUpdates === '1', contextToken: mode.contextToken }
  }

  async sensitive({ response }: HttpContext) {
    noStore(this.#context)
    return response.forbidden({
      code: 'E_MASQUERADE_ACTION_BLOCKED',
      message: 'Sensitive account actions are unavailable in support mode.',
    })
  }
}

function customerBouncer({ auth }: HttpContext) {
  return new Bouncer<User>(() => (auth.user as User | undefined) ?? null)
}

function changedContext({ response }: HttpContext) {
  return response.status(409).send({
    code: 'E_MASQUERADE_CONTEXT_CHANGED',
    message: 'Check status and choose a customer again.',
  })
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
