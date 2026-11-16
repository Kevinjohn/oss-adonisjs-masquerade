import { lstatSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const leasePath = fileURLToPath(new URL('../tmp/pg-test-lease.json', import.meta.url))
const schemaName = /^(?:consumer_(?:floor|latest)|kit)_[0-9a-f]{32}$/

function validDatabaseName(name: string | undefined): name is string {
  return (
    !!name?.trim() &&
    !name.includes('\0') &&
    Buffer.byteLength(name, 'utf8') <= 63 &&
    Buffer.from(name, 'utf8').toString('utf8') === name
  )
}

/** Validate the destination before any test-mode PostgreSQL migration can boot. */
export function testPostgresTarget(ordinaryDatabase: string | undefined) {
  const target = process.env.DB_TEST_DATABASE
  const schema = process.env.DB_TEST_SCHEMA ?? 'public'
  if (!validDatabaseName(ordinaryDatabase)) {
    throw new Error('PostgreSQL tests require an exported, nonblank ordinary DB_DATABASE')
  }
  if (!validDatabaseName(target)) {
    throw new Error('PostgreSQL tests require an explicit, valid DB_TEST_DATABASE')
  }

  const leaseFile = lstatSync(leasePath, { throwIfNoEntry: false })
  if (leaseFile) {
    if (!leaseFile.isFile()) throw new Error('PostgreSQL test lease must be a regular file')
    const contents = readFileSync(leasePath, 'utf8')
    let lease: unknown
    try {
      lease = JSON.parse(contents)
    } catch {
      throw new Error('PostgreSQL test lease is invalid')
    }
    const expected = {
      database: target,
      schema,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      nonce: process.env.NATIVE_PG_TEST_LEASE,
      ownerPid: Number(process.env.NATIVE_PG_TEST_LEASE_OWNER),
    }
    if (
      !schemaName.test(schema) ||
      !expected.host?.trim() ||
      !expected.port?.trim() ||
      !expected.user?.trim() ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(expected.nonce ?? '') ||
      !Number.isInteger(expected.ownerPid) ||
      expected.ownerPid < 1 ||
      JSON.stringify(lease) !== JSON.stringify(expected)
    ) {
      throw new Error('PostgreSQL test lease does not match the selected connection')
    }
    try {
      process.kill(expected.ownerPid, 0)
    } catch {
      throw new Error('PostgreSQL test lease owner is no longer running')
    }
  } else if (target === ordinaryDatabase) {
    throw new Error('DB_TEST_DATABASE must differ from ordinary DB_DATABASE without a runner lease')
  }
  return { database: target, schema }
}

/** The fixed SQLite test file cannot alias the ordinary demo file. */
export function assertSeparateSqliteFiles(demo: string, target: string) {
  if (demo === target) throw new Error('SQLite test database must differ from the demo database')
  const testFile = lstatSync(target, { throwIfNoEntry: false })
  if (!testFile) return
  if (testFile.isSymbolicLink()) throw new Error('SQLite test database must not be a symlink')
  const demoFile = lstatSync(demo, { throwIfNoEntry: false })
  if (!demoFile) return
  const selected = statSync(target)
  const ordinary = statSync(demo)
  if (selected.dev === ordinary.dev && selected.ino === ordinary.ino) {
    throw new Error('SQLite test database must differ from the demo database')
  }
}
