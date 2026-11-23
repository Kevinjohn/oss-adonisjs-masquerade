import { test } from '@japa/runner'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sqlFixture } from './helpers/sql_store.js'
import type { BaseSchema } from '@adonisjs/lucid/schema'

test('the v1 migration creates indexed tables with the owner primary key and rolls them back', async ({
  assert,
}) => {
  const f = await sqlFixture({ createTables: false })
  const directory = await mkdtemp(join(tmpdir(), 'masquerade_migration_'))
  try {
    const stub = await readFile(
      new URL('../stubs/migrations/create_masquerade_tables.stub', import.meta.url),
      'utf8'
    )
    // The leading Core stub directive selects the generated filename; execute the migration body here.
    assert.match(stub, /^\{\{\{[\s\S]*?exports\(\{ to:/)
    const migrationBody = stub.replace(/^\{\{\{[\s\S]*?\}\}\}\r?\n/, '')
    const schemaModule = join(directory, 'schema.ts')
    await writeFile(
      schemaModule,
      `export { createMasqueradeSchemaV1, dropMasqueradeSchemaV1 } from ${JSON.stringify(
        new URL('../stores/lucid.ts', import.meta.url).href
      )}
      export function createMasqueradeSchema() { throw new Error('Unversioned create helper called') }
      export function dropMasqueradeSchema() { throw new Error('Unversioned drop helper called') }
      `
    )
    const source = migrationBody
      .replace(
        "'@adonisjs/lucid/schema'",
        JSON.stringify(import.meta.resolve('@adonisjs/lucid/schema'))
      )
      .replace(
        "'@kevinjohn/adonisjs-masquerade/stores/lucid'",
        JSON.stringify(pathToFileURL(schemaModule).href)
      )
    const file = join(directory, 'migration.ts')
    await writeFile(file, source)
    const { default: Migration } = (await import(pathToFileURL(file).href)) as {
      default: typeof BaseSchema
    }
    const dry = new Migration(f.client, 'create_masquerade', true)
    const queries = await dry.execUp()
    assert.isArray(queries)
    assert.isFalse(await f.client.schema.hasTable('masquerade_modes'))
    assert.isFalse(await f.client.schema.hasTable('masquerade_events'))
    await new Migration(f.client, 'create_masquerade', false).execUp()
    assert.isTrue(await f.client.schema.hasTable('masquerade_modes'))
    assert.isTrue(await f.client.schema.hasTable('masquerade_events'))

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

    await new Migration(f.client, 'drop_masquerade', false).execDown()
    assert.isFalse(await f.client.schema.hasTable('masquerade_modes'))
    assert.isFalse(await f.client.schema.hasTable('masquerade_events'))
  } finally {
    try {
      await f.cleanup()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
