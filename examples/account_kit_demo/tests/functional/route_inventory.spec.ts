import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'

const execFile = promisify(execFileCallback)
const appRoot = fileURLToPath(new URL('../../', import.meta.url))

test('demo route report has only four managed Account Kit endpoints', async ({ assert }) => {
  const { stdout, stderr } = await execFile(process.execPath, ['ace.js', 'masquerade:routes'], {
    cwd: appRoot,
    env: { ...process.env, NODE_ENV: 'test' },
  })
  const report = `${stdout}\n${stderr}`
  const lines = report.split('\n').map((line) => line.trim().replace(/\s+/g, ' '))
  const managed = lines.filter((line) => line.includes('/kit/'))
  assert.deepEqual(managed, [
    'GET /kit/auth/csrf [Account Kit managed (exempt) READ]',
    'POST /kit/auth/login [Account Kit managed (blocked while active) MUTATION]',
    'POST /kit/account/logout [Account Kit managed (exempt) MUTATION]',
    'PATCH /kit/account/profile [Account Kit managed (blocked while active) MUTATION]',
  ])
  assert.deepEqual(
    lines.filter((line) => line.includes('UNCLASSIFIED')),
    ['GET,HEAD / [UNCLASSIFIED READ]', 'GET,HEAD /login [UNCLASSIFIED READ]']
  )
  for (const path of ['/account/password', '/signup', '/support/json']) {
    assert.notInclude(report, path)
  }
  assert.isFalse(/\s\/logout(?:\s|$)/m.test(report))
})
