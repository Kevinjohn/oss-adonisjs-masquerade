import { allowMutation, sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'

router
  .get('/support/json', [() => import('#controllers/demo_json_controller'), 'shell'])
  .as('demo.json.shell')
  .use(middleware.auth({ guards: ['web'] }))

router
  .get('/support/json/customer', [() => import('#controllers/demo_json_controller'), 'customer'])
  .as('demo.json.customer')
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/support/json/customer/preference', [
    () => import('#controllers/demo_json_controller'),
    'preference',
  ])
  .as('demo.json.preference')
  .use(allowMutation())
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/support/json/customer/sensitive', [
    () => import('#controllers/demo_json_controller'),
    'sensitive',
  ])
  .as('demo.json.sensitive')
  .use(sensitive())
  .use(middleware.auth({ guards: ['web_effective'] }))
