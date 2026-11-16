import { unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const nativePgLeaseName = 'pg-test-lease.json'

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
