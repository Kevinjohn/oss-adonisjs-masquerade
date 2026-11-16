import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'
import { existsSync, lstatSync, statSync } from 'node:fs'

const migrations = { naturalSort: true, paths: ['database/migrations'] }
const testing = process.env.NODE_ENV === 'test'
const postgresDatabase = testing ? process.env.DB_TEST_DATABASE : process.env.DB_DATABASE
const postgresSchema = testing ? process.env.DB_TEST_SCHEMA : process.env.DB_SCHEMA
const demoSqlite = app.tmpPath('db.sqlite3')
const testSqlite = app.tmpPath('test-db.sqlite3')

if (testing && process.env.DB_CLIENT !== 'pg' && existsSync(testSqlite)) {
  if (lstatSync(testSqlite).isSymbolicLink())
    throw new Error('SQLite test database must not be a symlink')
  if (existsSync(demoSqlite)) {
    const testFile = statSync(testSqlite)
    const demoFile = statSync(demoSqlite)
    if (testFile.dev === demoFile.dev && testFile.ino === demoFile.ino) {
      throw new Error('SQLite test database must differ from the demo database')
    }
  }
}

if (testing && process.env.DB_CLIENT === 'pg') {
  if (!postgresDatabase || postgresDatabase === (process.env.DB_DATABASE ?? 'package_test')) {
    throw new Error('PostgreSQL tests require DB_TEST_DATABASE distinct from DB_DATABASE')
  }
  if (postgresSchema && postgresSchema === (process.env.DB_SCHEMA ?? 'public')) {
    throw new Error('DB_TEST_SCHEMA must differ from DB_SCHEMA when supplied')
  }
}

/** The same native-session fixture runs against both supported SQL engines. */
export default defineConfig({
  connection: process.env.DB_CLIENT === 'pg' ? 'pg' : 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: { filename: testing ? testSqlite : demoSqlite },
      useNullAsDefault: true,
      migrations,
    },
    pg: {
      client: 'pg',
      connection: {
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 55432),
        user: process.env.DB_USER ?? 'account_kit',
        password: process.env.DB_PASSWORD ?? '',
        database: postgresDatabase ?? 'package_test',
      },
      searchPath: [postgresSchema ?? 'public'],
      migrations,
    },
  },
})
