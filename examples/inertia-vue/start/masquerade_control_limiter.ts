import limiter from '@adonisjs/limiter/services/main'
import config from '@adonisjs/core/services/config'
import type User from '#models/user'

const duration = '1 minute'

export const startMasqueradeLimiter = limiter.define('masquerade_start', (ctx) => {
  const actor = ctx.auth.use('web').getUserOrFail() as User
  return limiter
    .allowRequests(config.get<number>('demo.startRequests'))
    .every(duration)
    .usingKey(String(actor.id))
})

export const stopMasqueradeLimiter = limiter.define('masquerade_stop', (ctx) => {
  const actor = ctx.auth.use('web').getUserOrFail() as User
  return limiter
    .allowRequests(config.get<number>('demo.stopRequests'))
    .every(duration)
    .usingKey(String(actor.id))
})
