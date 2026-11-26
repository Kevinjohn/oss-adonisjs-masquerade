import { test } from '@japa/runner'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import Database from 'better-sqlite3'
import {
  issueNativePgLease,
  nativePgTarget,
  revokeNativePgLease,
  withoutNativePgTestTargets,
} from '../../bin/helpers/native_pg_lease.ts'

const root = resolve(import.meta.dirname, '../..')
const apps = {
  native: join(root, 'examples/native-session'),
  api: join(root, 'examples/with_account_kit/api'),
}
const envFixture = `NODE_ENV=development
PORT=3333
HOST=127.0.0.1
LOG_LEVEL=error
APP_KEY=01234567890123456789012345678901
APP_URL=http://127.0.0.1:3333
SESSION_DRIVER=memory
LIMITER_STORE=memory
DB_CONNECTION=sqlite
DB_DATABASE=demo_database
`
const childScript = String.raw`
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import Database from 'better-sqlite3'
const [configFile, directory] = process.argv.slice(1)
const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const appUrl = moduleUrl('export default { tmpPath: (name) => ' + JSON.stringify(join(directory, 'tmp')) + ' + "/" + name, inDev: false, inTest: process.env.NODE_ENV === "test" }')
const lucidUrl = moduleUrl('export const defineConfig = (value) => value')
const envUrl = pathToFileURL(join(directory, 'start/env.js')).href
const helperUrl = pathToFileURL(join(directory, 'start/test_database_target.js')).href
let source = readFileSync(configFile, 'utf8')
source = source.replace("'@adonisjs/core/services/app'", JSON.stringify(appUrl))
source = source.replace("'@adonisjs/lucid'", JSON.stringify(lucidUrl))
source = source.replace("'#start/env'", JSON.stringify(envUrl))
source = source.replace("'#start/test_database_target'", JSON.stringify(helperUrl))
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const config = (await import(moduleUrl(compiled))).default
const active = config.connections[config.connection]
if (config.connection === 'pg' || config.connection === 'postgres') {
  console.log(JSON.stringify({ database: active.connection.database, schema: active.searchPath?.[0] }))
} else {
  const demoFile = join(directory, 'tmp/db.sqlite3')
  let mutationCount = 0
  if (process.env.ISOLATION_MUTANT === '1') {
    active.connection.filename = demoFile
    mutationCount++
  }
  const testDb = new Database(active.connection.filename)
  testDb.exec("CREATE TABLE IF NOT EXISTS users (email TEXT); INSERT INTO users VALUES ('discard@example.test'); DELETE FROM users")
  testDb.close()
  const reopened = new Database(demoFile, { readonly: true })
  const value = reopened.prepare('SELECT email FROM users').pluck().get()
  reopened.close()
  console.log(JSON.stringify({ value, demoFile, testFile: active.connection.filename, mutationCount }))
}
`

function fixture(
  kind: keyof typeof apps,
  overrides: Record<string, string> = {},
  files: Record<string, string> = {},
  link?: 'symlink' | 'hardlink' | 'dangling'
) {
  const directory = mkdtempSync(join(tmpdir(), 'example-database-isolation-'))
  const source = apps[kind]
  try {
    mkdirSync(join(directory, 'start'))
    mkdirSync(join(directory, 'tmp'))
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ type: 'module', imports: { '#start/*': './start/*.js' } })
    )
    for (const name of ['env.ts', ...(kind === 'native' ? ['test_database_target.ts'] : [])]) {
      const input = readFileSync(join(source, 'start', name), 'utf8')
      const output = ts.transpileModule(input, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText
      writeFileSync(join(directory, 'start', name.replace(/\.ts$/, '.js')), output)
    }
    writeFileSync(join(directory, '.env'), envFixture)
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(directory, name), content)
    if (overrides.DB_CLIENT !== 'pg' && overrides.DB_CONNECTION !== 'postgres') {
      const demo = new Database(join(directory, 'tmp/db.sqlite3'))
      demo.exec(
        "CREATE TABLE users (email TEXT); INSERT INTO users VALUES ('operator@example.test')"
      )
      demo.close()
      if (link === 'symlink')
        symlinkSync(join(directory, 'tmp/db.sqlite3'), join(directory, 'tmp/test-db.sqlite3'))
      if (link === 'dangling')
        symlinkSync(join(directory, 'tmp/missing.sqlite3'), join(directory, 'tmp/test-db.sqlite3'))
      if (link === 'hardlink')
        linkSync(join(directory, 'tmp/db.sqlite3'), join(directory, 'tmp/test-db.sqlite3'))
    }
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DB_') &&
          !key.startsWith('PG') &&
          !key.startsWith('ISOLATION_') &&
          !key.startsWith('NATIVE_PG_TEST_LEASE') &&
          key !== 'ENV_PATH' &&
          key !== 'NATIVE_TEST_SQLITE' &&
          key !== 'RUN_CAUSAL_MUTANT'
      )
    )
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', childScript, join(source, 'config/database.ts'), directory],
      {
        cwd: root,
        env: {
          ...environment,
          NODE_ENV: 'test',
          ...overrides,
          ...(process.env.RUN_CAUSAL_MUTANT === '1' && (overrides.NODE_ENV ?? 'test') === 'test'
            ? { ISOLATION_MUTANT: '1' }
            : {}),
        },
        encoding: 'utf8',
      }
    )
    return { ...result, output: result.status === 0 ? JSON.parse(result.stdout.trim()) : undefined }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const kind of ['native', 'api'] as const) {
  test(`${kind} test cleanup preserves the temporary demo database`, ({ assert }) => {
    const result = fixture(kind, { DB_CLIENT: 'sqlite', DB_CONNECTION: 'sqlite' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.output.mutationCount, process.env.RUN_CAUSAL_MUTANT === '1' ? 1 : 0)
    assert.equal(result.output.value, 'operator@example.test')
    assert.notEqual(result.output.demoFile, result.output.testFile)
  })

  test(`${kind} refuses linked SQLite test files`, ({ assert }) => {
    for (const link of ['symlink', 'hardlink', 'dangling'] as const) {
      const result = fixture(kind, { DB_CLIENT: 'sqlite', DB_CONNECTION: 'sqlite' }, {}, link)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /SQLite test database must/)
    }
  })

  test(`${kind} refuses PostgreSQL without a launch-time ordinary database`, ({ assert }) => {
    const engine = { DB_CLIENT: 'pg', DB_CONNECTION: 'postgres', DB_TEST_DATABASE: 'test_database' }
    const fileOnly = fixture(kind, engine)
    assert.notEqual(fileOnly.status, 0)
    assert.match(fileOnly.stderr, /exported, nonblank ordinary DB_DATABASE/)
    const driverDefault = fixture(kind, {
      ...engine,
      PGDATABASE: 'demo_database',
      PGUSER: 'demo_user',
    })
    assert.notEqual(driverDefault.status, 0)
    assert.match(driverDefault.stderr, /exported, nonblank ordinary DB_DATABASE/)
    const empty = fixture(kind, { ...engine, DB_DATABASE: '' })
    assert.notEqual(empty.status, 0)
    assert.match(empty.stderr, /exported, nonblank ordinary DB_DATABASE/)
  })

  test(`${kind} protects the exported ordinary database through test overlays`, ({ assert }) => {
    const engine = { DB_CLIENT: 'pg', DB_CONNECTION: 'postgres', DB_DATABASE: 'demo_database' }
    for (const overlay of ['.env.test', '.env.test.local', '.env.local']) {
      const result = fixture(
        kind,
        { ...engine, DB_TEST_DATABASE: 'demo_database' },
        { [overlay]: 'DB_DATABASE=shadow_database\n' }
      )
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /DB_TEST_DATABASE must differ/)
    }
    const distinct = fixture(kind, {
      ...engine,
      DB_TEST_DATABASE: 'test_database',
      DB_TEST_SCHEMA: 'public',
      DB_SCHEMA: 'public',
    })
    assert.equal(distinct.status, 0, distinct.stderr)
    assert.equal(distinct.output.database, 'test_database')
    if (kind === 'native') assert.equal(distinct.output.schema, 'public')
  })

  test(`${kind} accepts distinct connection names through the PostgreSQL byte limit`, ({
    assert,
  }) => {
    const engine = { DB_CLIENT: 'pg', DB_CONNECTION: 'postgres' }
    const hyphenated = fixture(kind, {
      ...engine,
      DB_DATABASE: 'team-demo',
      DB_TEST_DATABASE: 'team-test',
    })
    assert.equal(hyphenated.status, 0, hyphenated.stderr)
    assert.equal(hyphenated.output.database, 'team-test')
    const valid63 = `${'é'.repeat(31)}a`
    const distinct63 = `${'é'.repeat(31)}b`
    const multibyte = fixture(kind, {
      ...engine,
      DB_DATABASE: valid63,
      DB_TEST_DATABASE: distinct63,
    })
    assert.equal(multibyte.status, 0, multibyte.stderr)
    assert.equal(multibyte.output.database, distinct63)
    const tooLong = fixture(kind, {
      ...engine,
      DB_DATABASE: valid63,
      DB_TEST_DATABASE: 'é'.repeat(32),
    })
    assert.notEqual(tooLong.status, 0)
    assert.match(tooLong.stderr, /valid DB_TEST_DATABASE/)
  })
}

test('native demo command children select the guarded test file in development and production', ({
  assert,
}) => {
  for (const mode of ['development', 'production']) {
    const result = fixture('native', {
      NODE_ENV: mode,
      DB_CLIENT: 'sqlite',
      NATIVE_TEST_SQLITE: '1',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.output.value, 'operator@example.test')
    assert.notEqual(result.output.demoFile, result.output.testFile)
  }
  const postgres = fixture('native', {
    NODE_ENV: 'development',
    DB_CLIENT: 'pg',
    NATIVE_TEST_SQLITE: '1',
  })
  assert.notEqual(postgres.status, 0)
  assert.match(postgres.stderr, /only valid for SQLite/)
})

test('native shared PostgreSQL target requires the exact live runner lease', ({ assert }) => {
  const schema = `kit_${'a'.repeat(32)}`
  const nonce = '11111111-1111-4111-8111-111111111111'
  const env = {
    DB_CLIENT: 'pg',
    DB_DATABASE: 'team-demo',
    DB_TEST_DATABASE: 'team-demo',
    DB_TEST_SCHEMA: schema,
    DB_HOST: '127.0.0.1',
    DB_PORT: '55441',
    DB_USER: 'fixture_user',
    NATIVE_PG_TEST_LEASE: nonce,
    NATIVE_PG_TEST_LEASE_OWNER: String(process.pid),
  }
  const record = {
    database: 'team-demo',
    schema,
    host: '127.0.0.1',
    port: '55441',
    user: 'fixture_user',
    nonce,
    ownerPid: process.pid,
  }
  const missing = fixture('native', env)
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /runner lease/)
  const valid = fixture('native', env, { 'tmp/pg-test-lease.json': JSON.stringify(record) })
  assert.equal(valid.status, 0, valid.stderr)
  assert.equal(valid.output.database, 'team-demo')
  assert.equal(valid.output.schema, schema)
  const mismatch = fixture(
    'native',
    { ...env, DB_TEST_SCHEMA: `kit_${'b'.repeat(32)}` },
    {
      'tmp/pg-test-lease.json': JSON.stringify(record),
    }
  )
  assert.notEqual(mismatch.status, 0)
  assert.match(mismatch.stderr, /lease does not match/)
  const stale = fixture(
    'native',
    { ...env, NATIVE_PG_TEST_LEASE_OWNER: '99999999' },
    {
      'tmp/pg-test-lease.json': JSON.stringify({ ...record, ownerPid: 99999999 }),
    }
  )
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /owner is no longer running/)
})

test('matrix lease writer refuses collisions and revokes its record', async ({ assert }) => {
  const directory = mkdtempSync(join(tmpdir(), 'native-pg-lease-'))
  mkdirSync(join(directory, 'tmp'))
  try {
    const target = nativePgTarget(
      {
        DB_DATABASE: 'fixture_db',
        DB_HOST: '127.0.0.1',
        DB_PORT: '55441',
        DB_USER: 'fixture_user',
      },
      `kit_${'a'.repeat(32)}`
    )
    const nonce = await issueNativePgLease(directory, target)
    const record = JSON.parse(readFileSync(join(directory, 'tmp/pg-test-lease.json'), 'utf8'))
    assert.equal(record.nonce, nonce)
    assert.equal(record.database, target.database)
    assert.equal(record.schema, target.schema)
    let collision: unknown
    try {
      await issueNativePgLease(directory, target)
    } catch (error) {
      collision = error
    }
    assert.equal((collision as NodeJS.ErrnoException)?.code, 'EEXIST')
    await revokeNativePgLease(directory)
    assert.isFalse(existsSync(join(directory, 'tmp/pg-test-lease.json')))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('matrix environment preserves PostgreSQL TLS and authentication for each phase', ({
  assert,
}) => {
  const inherited = {
    PGSSLMODE: 'require',
    PGPASSWORD: 'fixture_password',
    PGPASSFILE: '/tmp/fixture-passfile',
    PGOPTIONS: '-c statement_timeout=1000',
    PGDATABASE: 'misleading_database',
    DB_TEST_DATABASE: 'misleading_test',
    DB_TEST_SCHEMA: 'public',
    DB_SCHEMA: 'public',
    NATIVE_PG_TEST_LEASE: 'stale',
  }
  const selected = withoutNativePgTestTargets(inherited)
  selected.DB_CLIENT = 'pg'
  selected.DB_HOST = '127.0.0.1'
  selected.DB_PORT = '55441'
  selected.DB_USER = 'fixture_user'
  selected.DB_PASSWORD = ''
  selected.DB_DATABASE = 'team-demo'
  const schema = `kit_${'a'.repeat(32)}`
  const target = nativePgTarget(selected, schema)
  selected.DB_TEST_DATABASE = target.database
  selected.DB_TEST_SCHEMA = target.schema
  selected.DB_SCHEMA = target.schema
  for (const phase of ['create', 'application', 'drop']) {
    assert.equal(selected.PGSSLMODE, 'require', phase)
    assert.equal(selected.PGPASSWORD, 'fixture_password', phase)
    assert.equal(selected.PGPASSFILE, '/tmp/fixture-passfile', phase)
    assert.equal(selected.PGOPTIONS, '-c statement_timeout=1000', phase)
    assert.equal(selected.DB_DATABASE, 'team-demo', phase)
    assert.equal(selected.DB_TEST_DATABASE, 'team-demo', phase)
    assert.equal(selected.DB_TEST_SCHEMA, schema, phase)
  }
  assert.isUndefined(selected.NATIVE_PG_TEST_LEASE)
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import pg from 'pg'; const c = new pg.Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE}); console.log(JSON.stringify({ssl:c.connectionParameters.ssl,hasPassword:Boolean(c.connectionParameters.password),database:c.connectionParameters.database,options:c.connectionParameters.options}))",
    ],
    { cwd: root, env: { ...process.env, ...selected }, encoding: 'utf8' }
  )
  assert.equal(probe.status, 0, probe.stderr)
  const connection = JSON.parse(probe.stdout.trim())
  assert.equal(connection.ssl, true)
  assert.equal(connection.hasPassword, true)
  assert.equal(connection.database, 'team-demo')
  assert.equal(connection.options, '-c statement_timeout=1000')
})
