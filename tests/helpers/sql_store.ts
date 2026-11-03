import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Database } from '@adonisjs/lucid/database'
import { Logger } from '@adonisjs/core/logger'
import { Application } from '@adonisjs/core/app'
import { Emitter } from '@adonisjs/core/events'
import {
  LucidControlStore,
  createMasqueradeSchema,
  dropMasqueradeSchema,
} from '../../stores/lucid.js'
import type { CompareAndSetInput, IdleModeRow } from '../../src/types.js'

export function transition(revision = 1): CompareAndSetInput {
  const owner = { namespace: 'sql', actorId: randomUUID(), actorIncarnation: 'original' }
  const id = randomUUID()
  const next: IdleModeRow = {
    ...owner,
    revision,
    revisionNonce: 'a'.repeat(32),
    modeId: randomUUID(),
    lastTransitionId: id,
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: 'idle',
    access: null,
    targetId: null,
    targetIncarnation: null,
    actorStampHash: null,
    targetStampHash: null,
    reason: null,
    startedAt: null,
    expiresAt: null,
  }
  return {
    owner,
    expected: null,
    next,
    event: {
      ...owner,
      id,
      modeId: next.modeId,
      at: next.updatedAt,
      kind: 'stopped',
      outcomeCode: 'stopped',
      revision,
    },
  }
}
export async function sqlFixture(options: { poolMax?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'masquerade_sql_'))
  const pg = process.env.DB_CLIENT === 'pg'
  const schema = `store_${randomUUID().replaceAll('-', '')}`
  const databases: Database[] = []
  function database() {
    const config = pg
      ? {
          client: 'pg' as const,
          connection: {
            host: process.env.DB_HOST ?? '127.0.0.1',
            port: Number(process.env.DB_PORT ?? 55432),
            user: process.env.DB_USER ?? 'account_kit',
            password: process.env.DB_PASSWORD ?? '',
            database: process.env.DB_DATABASE ?? 'package_test',
          },
          searchPath: [schema],
          pool: { min: 1, max: options.poolMax ?? 1 },
        }
      : {
          client: 'better-sqlite3' as const,
          connection: { filename: join(directory, 'store.sqlite') },
          useNullAsDefault: true,
          pool: { min: 1, max: options.poolMax ?? 1 },
        }
    const db = new Database(
      { connection: 'test', connections: { test: config } },
      new Logger({ name: 'test', enabled: false }),
      new Emitter(new Application(new URL('../../', import.meta.url), { environment: 'test' }))
    )
    databases.push(db)
    return db
  }
  const first = database()
  const client = first.connection()
  let schemaCreated = false
  let second: ReturnType<Database['connection']>
  try {
    if (pg) {
      await first.rawQuery(`create schema ${schema}`)
      schemaCreated = true
    }
    await createMasqueradeSchema(client.schema)
    second = database().connection()
    if (!pg) {
      await client.rawQuery('PRAGMA busy_timeout = 5')
      await second.rawQuery('PRAGMA busy_timeout = 5')
    }
  } catch (error) {
    try {
      if (schemaCreated) await first.rawQuery(`drop schema ${schema} cascade`)
    } finally {
      await Promise.allSettled(databases.map((db) => db.manager.closeAll()))
      await rm(directory, { recursive: true, force: true })
    }
    throw error
  }

  return {
    pg,
    client,
    second,
    store: new LucidControlStore(client),
    other: new LucidControlStore(second),
    async cleanup() {
      try {
        await dropMasqueradeSchema(client.schema)
        if (pg) await first.rawQuery(`drop schema ${schema}`)
      } finally {
        try {
          await Promise.all(databases.map((db) => db.manager.closeAll()))
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      }
    },
  }
}
