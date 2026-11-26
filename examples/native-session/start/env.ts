/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'
import { testPostgresTarget } from '#start/test_database_target'

export const ordinaryDatabaseFromLaunch = process.env.DB_DATABASE
export const nativeTestSqliteFromLaunch = process.env.NATIVE_TEST_SQLITE === '1'

const env = await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Rate limiter
  LIMITER_STORE: Env.schema.enum(['memory'] as const),
  MASQUERADE_START_REQUESTS: Env.schema.number.optional(),
  MASQUERADE_STOP_REQUESTS: Env.schema.number.optional(),

  // Masquerade alerts
  MASQUERADE_ALERT_WEBHOOK_URL: Env.schema.string.optional({ format: 'url', tld: false }),
})

export const postgresTestTarget =
  process.env.NODE_ENV === 'test' && process.env.DB_CLIENT === 'pg'
    ? testPostgresTarget(ordinaryDatabaseFromLaunch, process.env)
    : undefined

if (nativeTestSqliteFromLaunch && process.env.DB_CLIENT === 'pg') {
  throw new Error('NATIVE_TEST_SQLITE is only valid for SQLite')
}

export default env
