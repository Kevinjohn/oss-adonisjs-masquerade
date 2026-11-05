import { spawnSync } from 'node:child_process'
import { test } from '@japa/runner'
import { repoRoot } from '../helpers/tracked_markdown.js'

test('the test runner fails when its filters select no tests', ({ assert }) => {
  const result = spawnSync(
    process.execPath,
    ['--import=@poppinss/ts-exec', 'bin/test.ts', '--files=no_such_file.spec.ts'],
    { cwd: repoRoot, encoding: 'utf8' }
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.include(result.stderr, 'No tests executed')
}).timeout(30_000)
