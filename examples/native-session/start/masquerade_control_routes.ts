import { middleware } from '#start/kernel'
import { startMasqueradeLimiter, stopMasqueradeLimiter } from '#start/masquerade_control_limiter'
import router from '@adonisjs/core/services/router'
import { MasqueradeController } from 'adonisjs-masquerade/http'
import MasqueradeFormController from '#controllers/masquerade_form_controller'

router
  .group(() => {
    router.get('/', [MasqueradeController, 'status']).as('status')
    router
      .post('/start', [MasqueradeFormController, 'start'])
      .as('start')
      .use(startMasqueradeLimiter)
    router
      .post('/stop', [MasqueradeFormController, 'stop'])
      .as('stop')
      .use(stopMasqueradeLimiter)
  })
  .prefix('/masquerade')
  .as('masquerade')
  .use(middleware.auth({ guards: ['web'] }))
