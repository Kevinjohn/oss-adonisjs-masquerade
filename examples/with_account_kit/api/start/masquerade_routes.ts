import router from '@adonisjs/core/services/router'
import { masqueradeRoutes, sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import { startMasqueradeLimiter, stopMasqueradeLimiter } from '#start/masquerade_limiter'

// Controls always authenticate the operator with the raw bearer guard.
masqueradeRoutes(router, {
  auth: middleware.auth,
  guard: 'api',
  startLimiter: startMasqueradeLimiter,
  stopLimiter: stopMasqueradeLimiter,
})

router
  .group(() => {
    router
      .get('/account', ({ auth }) => {
        const user = auth.getUserOrFail()
        return { id: user.id, email: user.email }
      })
      .as('account')
    router
      .post('/sensitive', () => ({ allowed: true }))
      .as('sensitive')
      .use(sensitive())
  })
  .prefix('/api/v1/masquerade')
  .as('business.masquerade')
  .use(middleware.auth({ guards: ['api_effective'] }))
