import { Bouncer } from '@adonisjs/bouncer'
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade'
import { masqueradeRoutes } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import {
  startTokenMasqueradeLimiter,
  stopTokenMasqueradeLimiter,
} from '#start/masquerade_control_limiter'
import db from '@adonisjs/lucid/services/db'
import router from '@adonisjs/core/services/router'
import type User from '#models/user'

masqueradeRoutes(router, {
  auth: middleware.auth,
  guard: 'api',
  startLimiter: startTokenMasqueradeLimiter,
  stopLimiter: stopTokenMasqueradeLimiter,
  prefix: '/api/masquerade',
  as: 'token.masquerade',
})

router
  .post('/api/logout', async ({ auth }) => {
    await auth.use('api').invalidateToken()
    return { loggedOut: true }
  })
  .as('auth.logout')
  .use(middleware.auth({ guards: ['api'] }))

router
  .get('/api/support/customer', async (ctx) => {
    ctx.response.header('Cache-Control', 'private, no-store')
    ctx.response.vary(['Accept', 'X-Masquerade-Context'])

    const runtime = await ctx.containerResolver.make('masquerade.runtime')
    const admitted = await runtime.admit(ctx)
    if (!admitted.view.isMasquerading) {
      throw new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
    }

    const actor = admitted.actor.user as User
    const customer = admitted.effective.user as User
    const bouncer = new Bouncer<User>(() => customer)
    await bouncer.authorize(Bouncer.ability((user: User) => user.active && user.id === customer.id))
    const preference = await db.from('demo_preferences').where('user_id', customer.id).first()

    return {
      actor: { id: String(actor.id) },
      customer: {
        id: String(customer.id),
        fullName: customer.fullName,
        email: customer.email,
        emailUpdates: Boolean(preference?.email_updates),
      },
      mode: admitted.view,
    }
  })
  .as('token.demo.customer')
  .use(middleware.auth({ guards: ['api_effective'] }))
