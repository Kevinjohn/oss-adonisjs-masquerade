import { test } from '@japa/runner'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  copyNativeDemo,
  validateDemoWorkspace,
  writeDemoRecipe,
} from '../bin/helpers/account_kit_demo_workspace.ts'

test.group('Account Kit demo workspace', (group) => {
  let directory: string
  group.each.setup(async () => {
    directory = await mkdtemp(join(tmpdir(), 'account-kit-workspace-'))
    return async () => rm(directory, { recursive: true, force: true })
  })

  test('refuses an interrupted unmarked workspace and preserves its contents', async ({
    assert,
  }) => {
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'valuable.txt'), 'keep me')
    await assert.rejects(
      () => validateDemoWorkspace(workspace),
      /Inspect it, then move or remove it manually/
    )
    assert.equal(await readFile(join(workspace, 'valuable.txt'), 'utf8'), 'keep me')
    await writeDemoRecipe(workspace, 3398)
    assert.equal(await validateDemoWorkspace(workspace), workspace)
  })

  test('copies native source without overwriting persistent paths', async ({ assert }) => {
    const source = join(directory, 'source')
    const destination = join(directory, 'app')
    await mkdir(join(source, 'resources/js'), { recursive: true })
    await mkdir(join(source, 'tmp'))
    await mkdir(destination)
    await mkdir(join(destination, 'tmp'))
    await writeFile(join(source, 'source.txt'), 'new source')
    await writeFile(join(source, '.env'), 'new env')
    await writeFile(join(source, 'tmp/db.sqlite3'), 'new db')
    await writeFile(join(source, 'resources/js/demo_json.js'), 'excluded')
    await writeFile(join(destination, '.env'), 'existing env')
    await writeFile(join(destination, 'tmp/db.sqlite3'), 'existing db')
    await copyNativeDemo(source, destination)
    assert.equal(await readFile(join(destination, 'source.txt'), 'utf8'), 'new source')
    assert.equal(await readFile(join(destination, '.env'), 'utf8'), 'existing env')
    assert.equal(await readFile(join(destination, 'tmp/db.sqlite3'), 'utf8'), 'existing db')
    assert.notInclude(await readdir(join(destination, 'resources/js')), 'demo_json.js')
  })
})
