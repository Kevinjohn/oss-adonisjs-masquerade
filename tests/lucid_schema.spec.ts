import { test } from '@japa/runner'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sqlFixture } from './helpers/sql_store.js'
import type { BaseSchema } from '@adonisjs/lucid/schema'

test('migration stub respects Lucid dry-run, creates once and rolls back both tables', async ({
  assert,
}) => {
  const f = await sqlFixture()
  const directory = await mkdtemp(join(tmpdir(), 'masquerade_migration_'))
  try {
    await f.client.schema.dropTable('masquerade_events').dropTable('masquerade_modes')
    const stub = await readFile(
      new URL('../stubs/migrations/create_masquerade_tables.stub', import.meta.url),
      'utf8'
    )
    // The leading Core stub directive selects the generated filename; execute the migration body here.
    assert.match(stub, /^\{\{\{[\s\S]*?exports\(\{ to:/)
    const migrationBody = stub.replace(/^\{\{\{[\s\S]*?\}\}\}\r?\n/, '')
    const source = migrationBody
      .replace(
        "'@adonisjs/lucid/schema'",
        JSON.stringify(import.meta.resolve('@adonisjs/lucid/schema'))
      )
      .replace(
        "'@kevinjohn/adonisjs-masquerade/stores/lucid'",
        JSON.stringify(new URL('../stores/lucid.ts', import.meta.url).href)
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
    await new Migration(f.client, 'create_masquerade', false).execUp()
    assert.isTrue(await f.client.schema.hasTable('masquerade_modes'))
    assert.isTrue(await f.client.schema.hasTable('masquerade_events'))
    await new Migration(f.client, 'drop_masquerade', false).execDown()
    assert.isFalse(await f.client.schema.hasTable('masquerade_modes'))
    assert.isFalse(await f.client.schema.hasTable('masquerade_events'))
    // Fixture cleanup owns these tables.
    await new Migration(f.client, 'recreate_masquerade', false).execUp()
  } finally {
    await f.cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})
