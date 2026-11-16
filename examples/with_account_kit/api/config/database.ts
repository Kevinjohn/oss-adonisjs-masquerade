import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'
import { lstatSync, statSync } from 'node:fs'

const testing = env.get('NODE_ENV') === 'test'
const demoSqlite = app.tmpPath('db.sqlite3')
const testSqlite = app.tmpPath('test-db.sqlite3')

const testFile =
  testing && env.get('DB_CONNECTION') === 'sqlite'
    ? lstatSync(testSqlite, { throwIfNoEntry: false })
    : undefined
if (testFile) {
  if (testFile.isSymbolicLink()) throw new Error('SQLite test database must not be a symlink')
  if (lstatSync(demoSqlite, { throwIfNoEntry: false })) {
    const selected = statSync(testSqlite)
    const demoFile = statSync(demoSqlite)
    if (selected.dev === demoFile.dev && selected.ino === demoFile.ino) {
      throw new Error('SQLite test database must differ from the demo database')
    }
  }
}
const postgresDatabase = testing ? env.get('DB_TEST_DATABASE') : env.get('DB_DATABASE')

const dbConfig = defineConfig({
  /**
   * Default connection used for all queries.
   */
  connection: env.get('DB_CONNECTION'),

  connections: {
    /**
     * SQLite connection (default).
     */
    sqlite: {
      client: 'better-sqlite3',

      connection: {
        filename: testing ? testSqlite : demoSqlite,
      },
      pool: {
        min: 1,
        max: 1,
        afterCreate(connection, callback) {
          connection.pragma('foreign_keys = ON')
          callback(null, connection)
        },
      },

      /**
       * Required by Knex for SQLite defaults.
       */
      useNullAsDefault: true,

      migrations: {
        /**
         * Sort migration files naturally by filename.
         */
        naturalSort: true,

        /**
         * Paths containing migration files.
         */
        paths: ['database/migrations'],
      },

      schemaGeneration: {
        /**
         * Enable schema generation from Lucid models.
         */
        enabled: true,

        /**
         * Custom schema rules file paths.
         */
        rulesPaths: ['./database/schema_rules.js'],
      },
    },

    /**
     * PostgreSQL connection.
     */
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD') || undefined,
        database: postgresDatabase,
      },
      migrations: { naturalSort: true, paths: ['database/migrations'] },
      debug: app.inDev,
    },
  },
})

export default dbConfig
