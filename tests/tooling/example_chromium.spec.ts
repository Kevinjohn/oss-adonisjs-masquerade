import { test } from '@japa/runner'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromiumInstallArgs } from '../../bin/helpers/example_chromium.js'

test('Chromium installation resolves the browser client peer and invokes its CLI', ({
  cleanup,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'example-chromium-'))
  cleanup(() => rmSync(directory, { recursive: true, force: true }))
  const client = join(directory, 'node_modules', '@japa', 'browser-client')
  const peer = join(client, 'node_modules', 'playwright')
  mkdirSync(peer, { recursive: true })
  writeFileSync(join(directory, 'package.json'), '{}')
  writeFileSync(join(client, 'package.json'), JSON.stringify({ main: 'index.js' }))
  writeFileSync(join(client, 'index.js'), '')
  writeFileSync(join(peer, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  writeFileSync(
    join(peer, 'cli.js'),
    'console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}))'
  )
  const args = chromiumInstallArgs(directory)
  assert.deepEqual(args.slice(0, 3), ['exec', 'node', realpathSync(join(peer, 'cli.js'))])
  const result = spawnSync(process.execPath, args.slice(2), { cwd: directory, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ['install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'],
    cwd: realpathSync(directory),
  })
})

test('Chromium resolution preserves a missing browser-client failure', ({ cleanup }) => {
  const directory = mkdtempSync(join(tmpdir(), 'example-chromium-missing-'))
  cleanup(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, 'package.json'), '{}')
  assert.throws(() => chromiumInstallArgs(directory), { code: 'MODULE_NOT_FOUND' })
})
