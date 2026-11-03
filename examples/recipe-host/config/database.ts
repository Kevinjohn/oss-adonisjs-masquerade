import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

const migrations = { naturalSort: true, paths: ['database/migrations'] }

export default defineConfig({
  connection: process.env.DB_CLIENT === 'pg' ? 'pg' : 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: { filename: app.tmpPath('db.sqlite3') },
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
        database: process.env.DB_DATABASE ?? 'package_test',
      },
      searchPath: [process.env.DB_SCHEMA ?? 'public'],
      migrations,
    },
  },
})
