import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'

const appRoot = new URL('../../', import.meta.url)

test('Vite bundles every script referenced by demo layouts and login', async ({ assert }) => {
  const config = await readFile(new URL('vite.config.ts', appRoot), 'utf8')
  for (const entrypoint of [
    'resources/css/app.css',
    'resources/js/app.js',
    'resources/js/account_kit_forms.js',
  ]) {
    assert.include(config, `'${entrypoint}'`)
    await access(fileURLToPath(new URL(entrypoint, appRoot)))
  }
  assert.notInclude(config, 'resources/js/demo_json.js')
  assert.include(config, "reload: ['resources/views/**/*.edge']")
  assert.include(config, "ignored: ['**/storage/**', '**/tmp/**']")
})
