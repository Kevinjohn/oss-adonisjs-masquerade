import limiter from '@adonisjs/limiter/services/main'
import config from '@adonisjs/core/services/config'
import type User from '#models/user'

const duration = '1 minute'

const startLimit = () =>
  limiter.allowRequests(config.get<number>('demo.startRequests')).every(duration)
const stopLimit = () =>
  limiter.allowRequests(config.get<number>('demo.stopRequests')).every(duration)

export const startMasqueradeLimiter = limiter.define('masquerade_start', (ctx) => {
  const actor = ctx.auth.use('web').getUserOrFail() as User
  return startLimit().usingKey(String(actor.id))
})

export const stopMasqueradeLimiter = limiter.define('masquerade_stop', (ctx) => {
  const actor = ctx.auth.use('web').getUserOrFail() as User
  return stopLimit().usingKey(String(actor.id))
})

export const startTokenMasqueradeLimiter = limiter.define('token_masquerade_start', (ctx) => {
  const actor = ctx.auth.use('api').getUserOrFail() as User
  return startLimit().usingKey(String(actor.id))
})

export const stopTokenMasqueradeLimiter = limiter.define('token_masquerade_stop', (ctx) => {
  const actor = ctx.auth.use('api').getUserOrFail() as User
  return stopLimit().usingKey(String(actor.id))
})
