import User from '#models/user'
import { demoAccounts } from '#services/demo_accounts'
import { Bouncer } from '@adonisjs/bouncer'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { shareMasquerade } from 'adonisjs-masquerade/http'
import MasqueradeFormController from '#controllers/masquerade_form_controller'
import type { MasqueradeFormFlash } from '#controllers/masquerade_form_controller'

/** Host-owned workspace and account query around the generated form controller. */
export default class DemoController extends MasqueradeFormController {
  override async status(ctx: HttpContext): Promise<void> {
    noStore(ctx)
    const actor = ctx.auth.use('web').getUserOrFail() as User
    const runtime = await ctx.containerResolver.make('masquerade.runtime')
    const mode = await runtime.service.status(ctx)
    const masqueradeFlash = ctx.session.flashMessages.get('masquerade') as
      MasqueradeFormFlash | undefined
    const customerEmails = demoAccounts
      .filter((account) => !account.masqueradeOperator)
      .map((account) => account.email)
    const customers = actor.masqueradeOperator
      ? await User.query().whereIn('email', customerEmails).where('active', true)
      : []
    const target = mode.isMasquerading ? await User.find(mode.targetId) : null
    ctx.response.send(
      await ctx.view.render('pages/demo_workspace', {
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

  protected override redirectAfterStart(_ctx: HttpContext): string {
    return '/support/customer'
  }

  protected override redirectAfterStop(_ctx: HttpContext): string {
    return '/support'
  }

  protected override errorPath(_ctx: HttpContext, _action: 'start' | 'stop'): string {
    return '/support'
  }

  async customer(ctx: HttpContext) {
    noStore(ctx)
    const mode = await shareMasquerade(ctx)
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= (await now())) {
      return ctx.response.redirect().toPath('/support')
    }
    const actor = ctx.auth.use('web').getUserOrFail() as User
    const customer = ctx.auth.user as User
    await customerBouncer(ctx).authorize(
      Bouncer.ability((user: User) => user.active && user.id === customer.id)
    )
    const preference = await db.from('demo_preferences').where('user_id', customer.id).first()
    return ctx.view.render('pages/demo_customer', {
      actor,
      customer,
      mode,
      expiresText: formatDeadline(mode.expiresAt),
      emailUpdates: Boolean(preference?.email_updates),
      canEdit: await customerBouncer(ctx).allows(
        Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
      ),
    })
  }

  async preference(ctx: HttpContext) {
    noStore(ctx)
    const mode = await shareMasquerade(ctx)
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= (await now())) {
      return ctx.response.redirect().toPath('/support')
    }
    const customer = ctx.auth.user as User
    await customerBouncer(ctx).authorize(
      Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
    )
    const value = ctx.request.input('emailUpdates')
    if (value !== '0' && value !== '1') {
      return ctx.response.badRequest('Choose on or off for email updates.')
    }
    await db
      .table('demo_preferences')
      .insert({ user_id: customer.id, email_updates: value === '1' })
      .onConflict('user_id')
      .merge()
    ctx.session.flash('success', 'Customer email preference saved.')
    return ctx.response.redirect().toPath('/support/customer')
  }

  async sensitive(ctx: HttpContext) {
    // The sensitive marker rejects an active mode before this handler runs.
    return ctx.response.forbidden('Sensitive account actions are unavailable in support mode.')
  }
}

function customerBouncer(ctx: HttpContext) {
  return new Bouncer<User>(() => (ctx.auth.user as User | undefined) ?? null)
}

function noStore(ctx: HttpContext) {
  ctx.response.header('Cache-Control', 'private, no-store')
  ctx.response.vary(['Accept', 'X-Masquerade-Context'])
}

async function now() {
  if (process.env.NODE_ENV === 'test') {
    const { masqueradeNow } = await import('#services/masquerade_test_boundary')
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
