import { test } from '@japa/runner'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatDemoSchema,
  formatDemoSources,
  newDemoMigrationPaths,
  snapshotDemoMigrations,
} from '../bin/helpers/account_kit_demo_format.ts'

test.group('Account Kit demo formatting', (group) => {
  let app: string
  group.each.setup(async () => {
    app = await mkdtemp(join(tmpdir(), 'account-kit-format-'))
    await mkdir(join(app, 'database/migrations'), { recursive: true })
    return async () => rm(app, { recursive: true, force: true })
  })

  test('selects only newly generated Kit migrations', async ({ assert }) => {
    const migrations = join(app, 'database/migrations')
    await writeFile(join(migrations, '100_account_kit_create_accounts.ts'), 'existing')
    const before = await snapshotDemoMigrations(app)
    await writeFile(join(migrations, '101_account_kit_admission_create_admissions.ts'), 'new')
    await writeFile(join(migrations, '102_create_other_table.ts'), 'other')
    assert.deepEqual(await newDemoMigrationPaths(app, before), [
      'database/migrations/101_account_kit_admission_create_admissions.ts',
    ])
    assert.equal(
      await readFile(join(migrations, '100_account_kit_create_accounts.ts'), 'utf8'),
      'existing'
    )
  })

  test('passes explicit source paths and formats schema separately', async ({ assert }) => {
    const executable = join(app, 'pnpm')
    const capture = join(app, 'arguments.txt')
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > '${capture}'\n`)
    await chmod(executable, 0o755)
    const env = { ...process.env, PATH: `${app}:${process.env.PATH ?? ''}` }
    await formatDemoSources(app, env, new Set())
    const sourceCapture = await readFile(capture, 'utf8')
    const sourceArgs = sourceCapture.trim().split('\n')
    assert.deepEqual(sourceArgs.slice(0, 3), ['exec', 'prettier', '--write'])
    assert.include(sourceArgs, 'adonisrc.ts')
    assert.include(sourceArgs, 'start/env.ts')
    assert.notInclude(sourceArgs, 'database/schema.ts')
    await formatDemoSchema(app, env)
    const schemaCapture = await readFile(capture, 'utf8')
    assert.deepEqual(schemaCapture.trim().split('\n'), [
      'exec',
      'prettier',
      '--write',
      'database/schema.ts',
    ])
  })
})
