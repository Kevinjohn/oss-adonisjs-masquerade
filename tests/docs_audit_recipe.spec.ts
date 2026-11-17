import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'

test('the audit history guide matches the native-session recipe controller', async ({ assert }) => {
  const page = await readFile(new URL('../docs/guide/audit.md', import.meta.url), 'utf8')
  const controller = await readFile(
    new URL(
      '../examples/native-session/app/controllers/masquerade_history_controller.ts',
      import.meta.url
    ),
    'utf8'
  )
  const block = page.match(/<!-- host-recipe:masquerade-history -->\n\n```ts\n([\s\S]*?)```/)

  assert.isNotNull(block)
  assert.equal(block![1], controller)
})
