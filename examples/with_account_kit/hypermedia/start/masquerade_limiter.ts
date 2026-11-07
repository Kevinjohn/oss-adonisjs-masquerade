import limiter from '@adonisjs/limiter/services/main'
import type UserModel from '#models/user'

type User = InstanceType<typeof UserModel>

// Separate start and stop budgets per operator. Tune them to your support workflow.
const duration = '1 minute'

export const startMasqueradeLimiter = limiter.define('masquerade_start', (ctx) => {
  const actor = ctx.auth.use('web').getUserOrFail() as User
  return limiter.allowRequests(10).every(duration).usingKey(String(actor.id))
})

export const stopMasqueradeLimiter = limiter.define('masquerade_stop', (ctx) => {
  const actor = ctx.auth.use('web').getUserOrFail() as User
  return limiter.allowRequests(10).every(duration).usingKey(String(actor.id))
})