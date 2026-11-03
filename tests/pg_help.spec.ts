import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from '@japa/runner'
import { repoRoot } from './helpers/tracked_markdown.js'

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

const debianBin = '/usr/lib/postgresql/16/bin'

function pgStatus(pgBin?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
  }
  delete env.PG_BIN
  if (pgBin !== undefined) env.PG_BIN = pgBin
  return spawnSync('/bin/bash', [join(repoRoot, 'bin/pg.sh'), 'status'], { env, encoding: 'utf8' })
}

test('finds the Debian and Ubuntu postgresql-16 binaries that are not on PATH', ({ assert }) => {
  const result = pgStatus()
  assert.notInclude(result.stderr, 'PostgreSQL 16 not found')
  assert.match(result.stdout, /owned cluster (running|stopped)/)
}).skip(!existsSync(join(debianBin, 'pg_ctl')), `PostgreSQL 16 is not installed at ${debianBin}`)

test('PG_BIN selects the bin directory ahead of installed PostgreSQL', ({ assert }) => {
  const empty = mkdtempSync(join(tmpdir(), 'postgres-bin-'))
  try {
    const result = pgStatus(empty)
    assert.equal(result.status, 1)
    assert.include(result.stderr, 'PostgreSQL 16 not found')
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
}).skip(!existsSync(join(debianBin, 'pg_ctl')), `PostgreSQL 16 is not installed at ${debianBin}`)
