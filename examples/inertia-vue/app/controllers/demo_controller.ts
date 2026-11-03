import User from '#models/user'
import { demoAccounts } from '#services/demo_accounts'
import { controlInput } from '#services/support_control_input'
import { Bouncer } from '@adonisjs/bouncer'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { MasqueradeRuntime } from 'adonisjs-masquerade/masquerade_provider'

export default class DemoController {
  async workspace(ctx: HttpContext) {
    noStore(ctx)
    const actor = ctx.auth.use('web').getUserOrFail() as User
    const runtime = await getRuntime(ctx)
    const status = await runtime.service.status(ctx)
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
    prepareHistory(ctx)
    return ctx.inertia.render('support/workspace', {
      actor: label(actor),
      operator: Boolean(actor.masqueradeOperator),
      mode,
      customers: customers.map(label),
      target: target ? label(target) : null,
      beforeDeadline: mode.isMasquerading && Date.parse(mode.expiresAt!) > Date.now(),
      targetAvailable: Boolean(target?.active),
    })
  }

  async identity(ctx: HttpContext) {
    noStore(ctx)
    const runtime = await getRuntime(ctx)
    const status = await runtime.service.status(ctx)
    return ctx.response.json({ mode: publicMode(status) })
  }

  async start(ctx: HttpContext) {
    noStore(ctx)
    const runtime = await getRuntime(ctx)
    await runtime.service.start(ctx, controlInput(ctx, 'start'))
    ctx.session.flash('supportClearHistory', true)
    return ctx.response.redirect().toPath('/support/customer')
  }

  async stop(ctx: HttpContext) {
    noStore(ctx)
    const runtime = await getRuntime(ctx)
    await runtime.service.stop(ctx, controlInput(ctx, 'stop'))
    ctx.session.flash('supportClearHistory', true)
    return ctx.response.redirect().toPath('/support')
  }

  async customer(ctx: HttpContext) {
    noStore(ctx)
    const runtime = await getRuntime(ctx)
    const admitted = await runtime.admit(ctx)
    const mode = admitted.view
    if (!mode.isMasquerading || Date.parse(mode.expiresAt) <= Date.now()) {
      return ctx.response.redirect().toPath('/support')
    }
    const actor = ctx.auth.use('web').getUserOrFail() as User
    const customer = ctx.auth.user as User
    await customerBouncer(ctx).authorize(
      Bouncer.ability((user: User) => user.active && user.id === customer.id)
    )
    const preference = await db.from('demo_preferences').where('user_id', customer.id).first()
    prepareHistory(ctx)
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
      canEdit: await customerBouncer(ctx).allows(
        Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
      ),
    }
    const delayMs = process.env.NODE_ENV === 'test' ? Number(ctx.request.input('delayMs', 0)) : 0
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 3000)))
    }
    return ctx.inertia.render('support/customer', props)
  }

  async preference(ctx: HttpContext) {
    noStore(ctx)
    const runtime = await getRuntime(ctx)
    const admitted = await runtime.admit(ctx)
    if (!admitted.view.isMasquerading || Date.parse(admitted.view.expiresAt) <= Date.now()) {
      return ctx.response.redirect().toPath('/support')
    }
    const customer = ctx.auth.user as User
    await customerBouncer(ctx).authorize(
      Bouncer.ability((user: User) => user.active && user.canMutate && user.id === customer.id)
    )
    const value = ctx.request.input('emailUpdates')
    if (value !== '0' && value !== '1')
      return ctx.response.badRequest('Choose on or off for email updates.')
    await db
      .table('demo_preferences')
      .insert({ user_id: customer.id, email_updates: value === '1' })
      .onConflict('user_id')
      .merge()
    ctx.session.flash('success', 'Customer email preference saved.')
    return ctx.response.redirect().toPath('/support/customer')
  }

  async sensitive(ctx: HttpContext) {
    return ctx.response.forbidden('Sensitive account actions are unavailable in support mode.')
  }

  async recovery(ctx: HttpContext) {
    noStore(ctx)
    const title = ctx.session.flashMessages.get('supportRecoveryTitle') as string | undefined
    const message = ctx.session.flashMessages.get('supportRecovery') as string | undefined
    prepareHistory(ctx)
    return ctx.inertia.render('support/recovery', {
      title: title ?? 'Support action needs review',
      message: message ?? 'Check current support status before creating a new action.',
    })
  }
}

async function getRuntime(ctx: HttpContext) {
  return (await ctx.containerResolver.make('masquerade.runtime')) as MasqueradeRuntime<User>
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

function prepareHistory(ctx: HttpContext) {
  if (ctx.session.flashMessages.get('supportClearHistory')) ctx.inertia.clearHistory()
  ctx.inertia.encryptHistory()
}

function customerBouncer(ctx: HttpContext) {
  return new Bouncer<User>(() => (ctx.auth.user as User | undefined) ?? null)
}

function noStore(ctx: HttpContext) {
  ctx.response.header('Cache-Control', 'private, no-store')
  ctx.response.vary(['Accept', 'X-Masquerade-Context'])
}
