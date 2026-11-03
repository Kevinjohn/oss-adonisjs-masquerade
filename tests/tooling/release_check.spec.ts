import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { repoRoot } from '../helpers/tracked_markdown.js'

test('released changelog headings use the form bin/release_check.sh requires', async ({
  assert,
}) => {
  const changelog = await readFile(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  const headings = [...changelog.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading)
  const released = headings.filter((heading) => heading !== 'Unreleased')
  assert.isAbove(released.length, 0)
  assert.deepEqual(
    released.filter((heading) => !/^\S+ - \d{4}-\d{2}-\d{2}$/.test(heading)),
    []
  )
})
