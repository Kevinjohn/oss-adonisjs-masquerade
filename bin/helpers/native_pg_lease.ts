import { unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const nativePgLeaseName = 'pg-test-lease.json'

/** Keep inherited PostgreSQL transport and auth settings while clearing stale test targets. */
export function withoutNativePgTestTargets(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const selected = { ...environment }
  for (const key of Object.keys(selected)) {
    if (
      key.startsWith('DB_TEST_') ||
      key === 'DB_SCHEMA' ||
      key === 'NATIVE_TEST_SQLITE' ||
      key.startsWith('NATIVE_PG_TEST_LEASE')
    )
      delete selected[key]
  }
  return selected
}

function validDatabaseName(name: string): boolean {
  return (
    !!name.trim() &&
    !name.includes('\0') &&
    Buffer.byteLength(name, 'utf8') <= 63 &&
    Buffer.from(name, 'utf8').toString('utf8') === name
  )
}

type PgTarget = {
  database: string
  schema: string
  host: string
  port: string
  user: string
}

/** The runner issues this only after PostgreSQL confirms CREATE SCHEMA. */
export function nativePgTarget(env: NodeJS.ProcessEnv, schema: string): PgTarget {
  const target = {
    database: env.DB_DATABASE ?? '',
    schema,
    host: env.DB_HOST ?? '',
    port: env.DB_PORT ?? '',
    user: env.DB_USER ?? '',
  }
  if (
    Object.values(target).some((value) => !value.trim()) ||
    !validDatabaseName(target.database) ||
    !Number.isInteger(Number(target.port)) ||
    Number(target.port) < 1 ||
    Number(target.port) > 65535
  ) {
    throw new Error(
      'PostgreSQL matrix target must have explicit database, schema, host, port, and user'
    )
  }
  return target
}

export async function issueNativePgLease(app: string, target: PgTarget) {
  const nonce = randomUUID()
  await writeFile(
    join(app, 'tmp', nativePgLeaseName),
    JSON.stringify({ ...target, nonce, ownerPid: process.pid }),
    {
      flag: 'wx',
      mode: 0o600,
    }
  )
  return nonce
}

export async function revokeNativePgLease(app: string) {
  await unlink(join(app, 'tmp', nativePgLeaseName))
}
