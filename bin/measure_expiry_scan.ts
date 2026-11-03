import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3'
import pg from 'pg'
import type { Client as PgClient } from 'pg'

type DatabaseInstance = InstanceType<typeof Database>

const { Client } = pg
const totalOwners = 100_000
const activeOwners = 10_000
const expiredBacklogs = [100, 1_000, 8_000]
const batchSize = 100
const warmups = 5
const repetitions = 50
const now = '2030-01-01T00:00:00.000Z'
const future = '2030-01-02T00:00:00.000Z'
const query = `
  SELECT * FROM masquerade_modes
  WHERE state = 'active' AND expires_at <= ?
  ORDER BY updated_at, authority_namespace, actor_id, actor_incarnation
  LIMIT ?
`

function instant(offsetMilliseconds: number): string {
  return new Date(Date.parse('2029-12-01T00:00:00.000Z') + offsetMilliseconds).toISOString()
}

function ownerRow(index: number): (string | number | null)[] {
  const active = index < activeOwners
  const actorId = `actor-${String(index).padStart(6, '0')}`
  const updatedOffset = ((index * 7_919) % 1_728_000) * 1_000
  return [
    'benchmark',
    actorId,
    `incarnation-${String(index % 100).padStart(3, '0')}`,
    1,
    'a'.repeat(32),
    active ? 'active' : 'idle',
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    active ? `target-${String(index).padStart(6, '0')}` : null,
    active ? `target-incarnation-${String(index % 100).padStart(3, '0')}` : null,
    active ? 'b'.repeat(64) : null,
    active ? 'c'.repeat(64) : null,
    active ? `support case ${index}` : null,
    active ? '2029-12-01T00:00:00.000Z' : null,
    active ? future : null,
    instant(updatedOffset),
  ]
}

const columns = [
  'authority_namespace',
  'actor_id',
  'actor_incarnation',
  'revision',
  'revision_nonce',
  'state',
  'mode_id',
  'last_transition_id',
  'target_id',
  'target_incarnation',
  'actor_stamp_hash',
  'target_stamp_hash',
  'reason',
  'started_at',
  'expires_at',
  'updated_at',
]

function createTableSql(tableName: string): string {
  return `CREATE TABLE ${tableName} (
    authority_namespace VARCHAR(128) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    actor_incarnation VARCHAR(128) NOT NULL,
    revision BIGINT NOT NULL,
    revision_nonce VARCHAR(32) NOT NULL,
    state VARCHAR(6) NOT NULL,
    mode_id VARCHAR(36) NOT NULL,
    last_transition_id VARCHAR(36) NOT NULL,
    target_id VARCHAR(255),
    target_incarnation VARCHAR(128),
    actor_stamp_hash VARCHAR(64),
    target_stamp_hash VARCHAR(64),
    reason TEXT,
    started_at VARCHAR(24),
    expires_at VARCHAR(24),
    updated_at VARCHAR(24) NOT NULL,
    UNIQUE (authority_namespace, actor_id, actor_incarnation)
  )`
}

function createIndexSql(tableName: string): string {
  return `CREATE INDEX masquerade_modes_expiry_index
    ON ${tableName} (state, expires_at, updated_at)`
}

function quantile(values: number[], fraction: number): number {
  return values[Math.ceil(values.length * fraction) - 1]
}

function summarize(values: number[]): { medianMs: number; p95Ms: number } {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    medianMs: Number(quantile(sorted, 0.5).toFixed(3)),
    p95Ms: Number(quantile(sorted, 0.95).toFixed(3)),
  }
}

function sqliteBulkExpired(db: DatabaseInstance, backlog: number): void {
  const statement = db.prepare('UPDATE masquerade_modes SET expires_at = ? WHERE actor_id = ?')
  const update = db.transaction(() => {
    db.prepare("UPDATE masquerade_modes SET expires_at = ? WHERE state = 'active'").run(future)
    for (let index = 0; index < backlog; index++)
      statement.run(
        instant(-((index % 720) + 1) * 86_400_000),
        `actor-${String(index).padStart(6, '0')}`
      )
  })
  update()
}

async function postgresBulkExpired(
  client: PgClient,
  tableName: string,
  backlog: number
): Promise<void> {
  await client.query(`UPDATE ${tableName} SET expires_at = $1 WHERE state = 'active'`, [future])
  for (let offset = 0; offset < backlog; offset += 500) {
    const chunk = Math.min(500, backlog - offset)
    const values: string[] = []
    const parameters: (string | number)[] = []
    for (let index = 0; index < chunk; index++) {
      const ownerIndex = offset + index
      const base = index * 2
      values.push(`($${base + 1}, $${base + 2})`)
      parameters.push(
        `actor-${String(ownerIndex).padStart(6, '0')}`,
        instant(-((ownerIndex % 720) + 1) * 86_400_000)
      )
    }
    await client.query(
      `UPDATE ${tableName} AS modes SET expires_at = selected.expires_at
       FROM (VALUES ${values.join(',')}) AS selected(actor_id, expires_at)
       WHERE modes.actor_id = selected.actor_id`,
      parameters
    )
  }
}

async function measureSqlite() {
  const directory = mkdtempSync(join(tmpdir(), 'masquerade-expiry-sqlite-'))
  const path = join(directory, 'measure.db')
  let db
  try {
    db = new Database(path)
    db.exec(createTableSql('masquerade_modes'))
    db.exec(createIndexSql('masquerade_modes'))
    const insert = db.prepare(
      `INSERT INTO masquerade_modes (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
    )
    const load = db.transaction(() => {
      for (let index = 0; index < totalOwners; index++) insert.run(...ownerRow(index))
    })
    const loadStart = performance.now()
    load()
    db.exec('ANALYZE')
    const loadMs = Number((performance.now() - loadStart).toFixed(1))
    const version = (db.prepare('SELECT sqlite_version() AS version').get() as { version: string })
      .version
    const scenarios = []

    for (const backlog of expiredBacklogs) {
      sqliteBulkExpired(db, backlog)
      db.exec('ANALYZE masquerade_modes')
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(now, batchSize) as {
        detail: string
      }[]
      const timedQuery = db.prepare(query)
      const firstStart = performance.now()
      const firstRows = timedQuery.all(now, batchSize)
      const firstRunMs = Number((performance.now() - firstStart).toFixed(3))
      for (let index = 0; index < warmups; index++) timedQuery.all(now, batchSize)
      const times: number[] = []
      for (let index = 0; index < repetitions; index++) {
        const started = performance.now()
        timedQuery.all(now, batchSize)
        times.push(performance.now() - started)
      }
      scenarios.push({
        expiredBacklog: backlog,
        batchSize,
        rowsReturned: firstRows.length,
        firstPostSetupRunMs: firstRunMs,
        warmups,
        repetitions,
        warm: summarize(times),
        queryPlan: plan.map((step) => step.detail),
      })
    }
    return {
      backend: 'SQLite',
      version,
      totalOwners,
      activeOwners,
      idleOwners: totalOwners - activeOwners,
      batchSize,
      loadMs,
      scenarios,
    }
  } finally {
    db?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

async function measurePostgres() {
  const client = new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 55539),
    user: process.env.DB_USER ?? 'account_kit',
    password: process.env.DB_PASSWORD || undefined,
    database: process.env.DB_DATABASE ?? 'package_test',
  })
  const schema = `expiry_measurement_${randomBytes(5).toString('hex')}`
  await client.connect()
  let transactionOpen = false
  try {
    await client.query(`CREATE SCHEMA ${schema}`)
    const tableName = `${schema}.masquerade_modes`
    await client.query(createTableSql(tableName))
    await client.query(createIndexSql(tableName))
    const insertSql = `INSERT INTO ${tableName} (${columns.join(',')}) VALUES `
    const loadStart = performance.now()
    await client.query('BEGIN')
    transactionOpen = true
    for (let offset = 0; offset < totalOwners; offset += 1_000) {
      const chunk = Math.min(1_000, totalOwners - offset)
      const values = []
      const parameters = []
      for (let index = 0; index < chunk; index++) {
        const base = index * columns.length
        values.push(`(${columns.map((_, column) => `$${base + column + 1}`).join(',')})`)
        parameters.push(...ownerRow(offset + index))
      }
      await client.query(`${insertSql}${values.join(',')}`, parameters)
    }
    await client.query('COMMIT')
    transactionOpen = false
    await client.query(`ANALYZE ${tableName}`)
    const loadMs = Number((performance.now() - loadStart).toFixed(1))
    const { rows: versionRows } = await client.query(
      "SELECT version() AS version, current_setting('server_version_num') AS version_num"
    )
    const scenarios = []

    for (const backlog of expiredBacklogs) {
      await postgresBulkExpired(client, tableName, backlog)
      await client.query(`VACUUM (ANALYZE) ${tableName}`)
      const sql = query
        .replace('masquerade_modes', tableName)
        .replaceAll('?', '$1')
        .replace('LIMIT $1', 'LIMIT $2')
      const explain = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, [now, batchSize])
      const plan = explain.rows[0]['QUERY PLAN'][0]
      const firstStart = performance.now()
      const firstResult = await client.query(sql, [now, batchSize])
      const firstRunMs = Number((performance.now() - firstStart).toFixed(3))
      for (let index = 0; index < warmups; index++) await client.query(sql, [now, batchSize])
      const times: number[] = []
      for (let index = 0; index < repetitions; index++) {
        const started = performance.now()
        await client.query(sql, [now, batchSize])
        times.push(performance.now() - started)
      }
      const analyze = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, [
        now,
        batchSize,
      ])
      scenarios.push({
        expiredBacklog: backlog,
        batchSize,
        rowsReturned: firstResult.rowCount,
        firstPostSetupRunMs: firstRunMs,
        warmups,
        repetitions,
        warm: summarize(times),
        queryPlan: plan,
        explainAnalyze: analyze.rows[0]['QUERY PLAN'][0],
      })
    }
    return {
      backend: 'PostgreSQL',
      version: versionRows[0].version,
      serverVersionNum: versionRows[0].version_num,
      totalOwners,
      activeOwners,
      idleOwners: totalOwners - activeOwners,
      batchSize,
      loadMs,
      scenarios,
    }
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {})
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    } finally {
      await client.end()
    }
  }
}

const backend = process.argv[2]
if (!['sqlite', 'postgres'].includes(backend)) {
  console.error('Usage: node bin/measure_expiry_scan.ts <sqlite|postgres>')
  process.exitCode = 2
} else {
  const result = backend === 'sqlite' ? await measureSqlite() : await measurePostgres()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
