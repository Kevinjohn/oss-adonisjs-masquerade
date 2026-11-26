import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { repoRoot } from './helpers/tracked_markdown.ts'

test('missing PostgreSQL binaries point to the external-server instructions', ({ assert }) => {
  const path = mkdtempSync(join(tmpdir(), 'postgres-help-'))
  try {
    symlinkSync('/usr/bin/dirname', join(path, 'dirname'))
    const result = spawnSync('/bin/bash', [join(repoRoot, 'bin/pg.sh'), 'test'], {
      env: { ...process.env, PATH: path },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.include(result.stderr, 'PostgreSQL 16 not found')
    assert.include(result.stderr, 'docs/maintainers/conventions.md#external-postgresql')
    const instructions = readFileSync(join(repoRoot, 'docs/maintainers/conventions.md'), 'utf8')
    assert.include(instructions, '## External PostgreSQL')
    for (const setting of [
      'DB_CLIENT=pg',
      'DB_HOST=',
      'DB_PORT=',
      'DB_USER=',
      'DB_PASSWORD=',
      'DB_DATABASE=',
    ])
      assert.include(instructions, setting)
    assert.include(instructions, 'pnpm quick:test')
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
})
