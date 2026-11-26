import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'
import { nativeTestSqliteFromLaunch, postgresTestTarget } from '#start/env'
import { assertSeparateSqliteFiles } from '#start/test_database_target'

const testing = app.inTest
const selectedTestSqlite = testing || nativeTestSqliteFromLaunch
const demoSqlite = app.tmpPath('db.sqlite3')
const testSqlite = app.tmpPath('test-db.sqlite3')

if (testing && process.env.DB_CLIENT === 'pg' && !postgresTestTarget) {
  throw new Error('PostgreSQL test target was not validated at launch')
}
if (selectedTestSqlite && process.env.DB_CLIENT !== 'pg')
  assertSeparateSqliteFiles(demoSqlite, testSqlite)

/** The same native-session fixture runs against both supported SQL engines. */
export default defineConfig({
  connection: process.env.DB_CLIENT === 'pg' ? 'pg' : 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: { filename: selectedTestSqlite ? testSqlite : demoSqlite },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
        disableRollbacksInProduction: true,
      },
    },
    pg: {
      client: 'pg',
      connection: {
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 55432),
        user: process.env.DB_USER ?? 'account_kit',
        password: process.env.DB_PASSWORD ?? '',
        database: postgresTestTarget?.database ?? process.env.DB_DATABASE ?? 'package_test',
      },
      searchPath: [postgresTestTarget?.schema ?? process.env.DB_SCHEMA ?? 'public'],
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
        disableRollbacksInProduction: true,
      },
    },
  },
})
