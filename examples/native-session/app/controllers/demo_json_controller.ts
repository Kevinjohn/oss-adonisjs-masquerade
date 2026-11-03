import User from '#models/user'
import { demoAccounts } from '#services/demo_accounts'
import { Bouncer } from '@adonisjs/bouncer'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { shareMasquerade } from 'adonisjs-masquerade/http'

/** Host-owned JSON views of the existing fictional support workflow. */
export default class DemoJsonController {
  async shell(ctx: HttpContext) {
    noStore(ctx)
    const actor = ctx.auth.use('web').getUserOrFail() as User
    const emails = demoAccounts.filter((account) => !account.masqueradeOperator).map((a) => a.email)
    const customers = actor.masqueradeOperator
      ? await User.query().whereIn('email', emails).where('active', true)
      : []
    return ctx.view.render('pages/demo_json', {
      actor,
      customers: customers.map(({ id, fullName, email }) => ({ id, fullName, email })),
    })
  }

  async customer(ctx: HttpContext) {
    noStore(ctx)
    const mode = await shareMasquerade(ctx)
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= (await now())) {
      return changedContext(ctx)
    }
    const actor = ctx.auth.use('web').getUserOrFail() as User
    const customer = ctx.auth.user as User
    await customerBouncer(ctx).authorize(
      Bouncer.ability((user: User) => user.active && user.id === customer.id)
    )
    const preference = await db.from('demo_preferences').where('user_id', customer.id).first()
    return {
      actor: { id: actor.id, email: actor.email },
      customer: { id: customer.id, fullName: customer.fullName, email: customer.email },
      mode: { contextToken: mode.contextToken, expiresAt: mode.expiresAt, access: mode.access },
      emailUpdates: Boolean(preference?.email_updates),
      canEdit: Boolean(
        await customerBouncer(ctx).allows(
          Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
        )
      ),
    }
  }

  async preference(ctx: HttpContext) {
    noStore(ctx)
    const mode = await shareMasquerade(ctx)
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= (await now())) {
      return changedContext(ctx)
    }
    const customer = ctx.auth.user as User
    await customerBouncer(ctx).authorize(
      Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
    )
    const value = ctx.request.input('emailUpdates')
    if (value !== '0' && value !== '1') {
      return ctx.response.unprocessableEntity({
        code: 'E_MASQUERADE_INVALID_INPUT',
        message: 'Choose on or off for email updates.',
      })
    }
    await db
      .table('demo_preferences')
      .insert({ user_id: customer.id, email_updates: value === '1' })
      .onConflict('user_id')
      .merge()
    return { emailUpdates: value === '1', contextToken: mode.contextToken }
  }

  async sensitive(ctx: HttpContext) {
    noStore(ctx)
    return ctx.response.forbidden({
      code: 'E_MASQUERADE_ACTION_BLOCKED',
      message: 'Sensitive account actions are unavailable in support mode.',
    })
  }
}

function customerBouncer(ctx: HttpContext) {
  return new Bouncer<User>(() => (ctx.auth.user as User | undefined) ?? null)
}

function changedContext(ctx: HttpContext) {
  return ctx.response.status(409).send({
    code: 'E_MASQUERADE_CONTEXT_CHANGED',
    message: 'Check status and choose a customer again.',
  })
}

function noStore(ctx: HttpContext) {
  ctx.response.header('Cache-Control', 'private, no-store')
  ctx.response.vary(['Accept', 'X-Masquerade-Context'])
}

async function now() {
  if (process.env.NODE_ENV === 'test') {
    const { masqueradeNow } = await import('#services/masquerade_fixture_boundary')
    return masqueradeNow()
  }
  return Date.now()
}
