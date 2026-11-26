import { test } from '@japa/runner'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sqlFixture } from './helpers/sql_store.ts'
import type { BaseSchema } from '@adonisjs/lucid/schema'

test('the v1 table migrations independently create indexed tables and roll them back', async ({
  assert,
}) => {
  const f = await sqlFixture({ createTables: false })
  const directory = await mkdtemp(join(tmpdir(), 'masquerade_migration_'))
  try {
    const migrations: { table: string; Migration: typeof BaseSchema }[] = []
    for (const table of ['modes', 'events']) {
      const stub = await readFile(
        new URL(`../stubs/make/migration/create_masquerade_${table}.stub`, import.meta.url),
        'utf8'
      )
      // The leading Core stub directive selects the generated filename; execute the migration body here.
      assert.match(stub, /^\{\{\{[\s\S]*?exports\(\{ to: app\.migrationsPath/)
      assert.include(stub, `protected tableName = 'masquerade_${table}'`)
      const migrationBody = stub.replace(/^\{\{\{[\s\S]*?\}\}\}\r?\n/, '')
      const source = migrationBody
        .replace(
          "'@adonisjs/lucid/schema'",
          JSON.stringify(import.meta.resolve('@adonisjs/lucid/schema'))
        )
        .replace(
          "'@kevinjohn/adonisjs-masquerade/stores/lucid'",
          JSON.stringify(new URL('../src/stores/lucid.ts', import.meta.url).href)
        )
      const file = join(directory, `${table}.ts`)
      await writeFile(file, source)
      const { default: Migration } = (await import(pathToFileURL(file).href)) as {
        default: typeof BaseSchema
      }
      migrations.push({ table, Migration })
      const dry = new Migration(f.client, `create_masquerade_${table}`, true)
      const queries = await dry.execUp()
      assert.isArray(queries)
      assert.isFalse(await f.client.schema.hasTable(`masquerade_${table}`))
      await new Migration(f.client, `create_masquerade_${table}`, false).execUp()
      assert.isTrue(await f.client.schema.hasTable(`masquerade_${table}`))
      if (table === 'modes') assert.isFalse(await f.client.schema.hasTable('masquerade_events'))
    }

    let ownerColumns: string[]
    let indexNames: string[]
    if (f.pg) {
      const identity = await f.client.rawQuery(
        "select relreplident from pg_class where oid = 'masquerade_modes'::regclass"
      )
      assert.deepEqual(identity.rows, [{ relreplident: 'd' }])
      const indexes = await f.client.rawQuery(
        `select indexname from pg_indexes
         where schemaname = current_schema()
           and tablename in ('masquerade_modes', 'masquerade_events')`
      )
      indexNames = indexes.rows.map(({ indexname }: { indexname: string }) => indexname)
      const result = await f.client.rawQuery(
        `select a.attname as name from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = 'masquerade_modes'::regclass and i.indisprimary`
      )
      ownerColumns = result.rows.map(({ name }: { name: string }) => name)
    } else {
      const modeIndexes: { name: string }[] = await f.client.rawQuery(
        'PRAGMA index_list(masquerade_modes)'
      )
      const eventIndexes: { name: string }[] = await f.client.rawQuery(
        'PRAGMA index_list(masquerade_events)'
      )
      indexNames = [...modeIndexes, ...eventIndexes].map(({ name }) => name)
      const info: { name: string; pk: number }[] = await f.client.rawQuery(
        'PRAGMA table_info(masquerade_modes)'
      )
      ownerColumns = info.filter((row) => row.pk > 0).map(({ name }) => name)
    }
    assert.sameMembers(ownerColumns, ['authority_namespace', 'actor_id', 'actor_incarnation'])
    assert.include(indexNames, 'masquerade_modes_expiry_index')
    assert.include(indexNames, 'masquerade_events_retention_index')

    for (const { table, Migration } of migrations.reverse()) {
      const dry = new Migration(f.client, `drop_masquerade_${table}`, true)
      assert.isArray(await dry.execDown())
      assert.isTrue(await f.client.schema.hasTable(`masquerade_${table}`))
      await new Migration(f.client, `drop_masquerade_${table}`, false).execDown()
      assert.isFalse(await f.client.schema.hasTable(`masquerade_${table}`))
      if (table === 'events') assert.isTrue(await f.client.schema.hasTable('masquerade_modes'))
    }
  } finally {
    try {
      await f.cleanup()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
