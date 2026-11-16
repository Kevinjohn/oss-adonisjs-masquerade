import { test } from '@japa/runner'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const nativeConfig = join(root, 'examples/native-session/config/database.ts')
const apiConfig = join(root, 'examples/with_account_kit/api/config/database.ts')

// Execute the real config module with only its framework imports replaced. Each run owns
// separate SQLite files, so the fixture can prove the demo's sentinel survives test cleanup.
const inspectConfig = String.raw`
import { linkSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import Database from 'better-sqlite3'
const [configFile, directory] = process.argv.slice(1)
if (process.env.DB_CLIENT !== 'pg' && process.env.DB_CONNECTION !== 'postgres') {
  const demo = new Database(join(directory, 'db.sqlite3'))
  demo.exec("CREATE TABLE users (value TEXT); INSERT INTO users VALUES ('preserve')")
  demo.close()
  if (process.env.ISOLATION_LINK === 'symlink') symlinkSync(join(directory, 'db.sqlite3'), join(directory, 'test-db.sqlite3'))
  if (process.env.ISOLATION_LINK === 'hardlink') linkSync(join(directory, 'db.sqlite3'), join(directory, 'test-db.sqlite3'))
}
const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const appUrl = moduleUrl('export default { tmpPath: (name) => ' + JSON.stringify(directory) + ' + "/" + name, inDev: false }')
const lucidUrl = moduleUrl('export const defineConfig = (value) => value')
const envUrl = moduleUrl('export default { get: (key) => process.env[key] }')
let source = readFileSync(configFile, 'utf8')
if (process.env.ISOLATION_MUTANT === '1') source = source.replace('test-db.sqlite3', 'db.sqlite3')
source = source.replace("'@adonisjs/core/services/app'", JSON.stringify(appUrl))
source = source.replace("'@adonisjs/lucid'", JSON.stringify(lucidUrl))
source = source.replace("'#start/env'", JSON.stringify(envUrl))
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const config = (await import(moduleUrl(compiled))).default
const active = config.connections[config.connection]
if (config.connection === 'pg' || config.connection === 'postgres') {
  console.log(JSON.stringify({ database: active.connection.database, schema: active.searchPath?.[0] }))
} else {
  const demoFile = join(directory, 'db.sqlite3')
  const testDb = new Database(active.connection.filename)
  testDb.exec("CREATE TABLE IF NOT EXISTS users (value TEXT); INSERT INTO users VALUES ('discard'); DELETE FROM users")
  testDb.close()
  const reopened = new Database(demoFile, { readonly: true })
  const value = reopened.prepare('SELECT value FROM users').pluck().get()
  reopened.close()
  console.log(JSON.stringify({ demoFile, testFile: active.connection.filename, value }))
}
`

function runConfig(configFile: string, kind: string, environment: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'example-database-isolation-'))
  try {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', inspectConfig, configFile, directory, kind],
      {
        cwd: root,
        env: { ...process.env, NODE_ENV: 'test', ...environment },
        encoding: 'utf8',
      }
    )
    return { ...result, output: result.status === 0 ? JSON.parse(result.stdout.trim()) : undefined }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const [kind, configFile, pgConnection] of [
  ['native', nativeConfig, 'pg'],
  ['api', apiConfig, 'postgres'],
] as const) {
  test(`${kind} tests preserve a separate SQLite demo database`, ({ assert }) => {
    const result = runConfig(configFile, kind, { DB_CLIENT: 'sqlite', DB_CONNECTION: 'sqlite' })
    assert.equal(result.status, 0, result.stderr)
    assert.notEqual(result.output.demoFile, result.output.testFile)
    assert.equal(result.output.value, 'preserve')
  })

  test(`${kind} tests reject a linked demo database`, ({ assert }) => {
    for (const link of ['symlink', 'hardlink']) {
      const result = runConfig(configFile, kind, {
        DB_CLIENT: 'sqlite',
        DB_CONNECTION: 'sqlite',
        ISOLATION_LINK: link,
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /SQLite test database must/)
    }
  })

  test(`${kind} PostgreSQL tests require a distinct database`, ({ assert }) => {
    const common = { DB_CLIENT: 'pg', DB_CONNECTION: pgConnection, DB_DATABASE: 'demo_db' }
    const missing = runConfig(configFile, kind, common)
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /DB_TEST_DATABASE/)
    const same = runConfig(configFile, kind, { ...common, DB_TEST_DATABASE: 'demo_db' })
    assert.notEqual(same.status, 0)
    assert.match(same.stderr, /DB_TEST_DATABASE/)
    const distinct = runConfig(configFile, kind, {
      ...common,
      DB_TEST_DATABASE: 'isolated_test_db',
    })
    assert.equal(distinct.status, 0, distinct.stderr)
    assert.equal(distinct.output.database, 'isolated_test_db')
  })
}
