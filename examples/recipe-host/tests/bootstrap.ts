import { assert } from '@japa/assert'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import { apiClient } from '@japa/api-client'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import { shieldApiClient } from '@adonisjs/shield/plugins/api_client'
import type { Config } from '@japa/runner/types'

export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  apiClient(),
  authApiClient(app),
  sessionApiClient(app),
  shieldApiClient(),
]

export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [],
  teardown: [
    // Japa exits 0 when its filters select nothing; a run that executed no tests checked nothing.
    (runner) => {
      if (runner.getSummary().aggregates.total > 0) return
      console.error('No tests executed: check the suite name and filters')
      process.exitCode = 1
    },
  ],
}

export const configureSuite: Config['configureSuite'] = (suite) => {
  if (suite.name === 'functional') return suite.setup(() => testUtils.httpServer().start())
}
