import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { repoRoot } from './helpers/tracked_markdown.js'

const records = join(repoRoot, 'docs/maintainers/adoption-validation')

test('the Vue host patch still matches the hash its replay record checks', async ({ assert }) => {
  const record = await readFile(join(records, 'vue.md'), 'utf8')
  const recorded = record.match(/The patch hash is `([0-9a-f]{64})`/)?.[1]
  const patch = await readFile(join(records, 'vue-fresh-host.patch'))
  assert.equal(createHash('sha256').update(patch).digest('hex'), recorded)
})
