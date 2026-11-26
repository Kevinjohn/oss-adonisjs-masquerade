import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'

const execFile = promisify(execFileCallback)
const appRoot = fileURLToPath(new URL('../../', import.meta.url))

test.group('test-only route registration boundary', () => {
  async function routeReport(nodeEnv: 'development' | 'production' | 'test'): Promise<string> {
    const { stdout, stderr } = await execFile(process.execPath, ['ace.js', 'masquerade:routes'], {
      cwd: appRoot,
      env: { ...process.env, NODE_ENV: nodeEnv },
    })
    return `${stdout}\n${stderr}`
  }

  test('Ace route reports include probes only when NODE_ENV is test', async ({ assert }) => {
    const [normal, production, testEnvironment] = await Promise.all([
      routeReport('development'),
      routeReport('production'),
      routeReport('test'),
    ])

    for (const report of [normal, production]) {
      assert.include(report, '/masquerade/start')
      assert.match(report, /GET,HEAD\s+\/api\/masquerade \[CONTROL READ\]/)
      assert.match(report, /POST\s+\/api\/masquerade\/start \[CONTROL MUTATION\]/)
      assert.match(report, /POST\s+\/api\/logout \[POSSIBLE CONTROL MUTATION\]/)
      assert.match(report, /GET,HEAD\s+\/api\/support\/customer \[BUSINESS READ\]/)
      assert.notInclude(report, '/api/business')
      assert.notInclude(report, '/api/business/mutate')
    }
    assert.match(normal, /\/support\/json \[RAW-GUARD BUSINESS READ\]/)
    assert.match(normal, /\/support\/json\/customer \[BUSINESS READ\]/)
    assert.match(
      normal,
      /\/support\/json\/customer\/preference \[BUSINESS MUTATION\] \(allowMutation\)/
    )
    assert.match(normal, /\/support\/json\/customer\/sensitive \[BUSINESS MUTATION\] \(sensitive\)/)
    assert.notInclude(normal, '/business/form')
    assert.notInclude(normal, '/business/mutate')
    assert.notInclude(normal, '/members/status')

    assert.include(testEnvironment, '/masquerade/start')
    assert.include(testEnvironment, '/business/form')
    assert.include(testEnvironment, '/business/mutate')
    assert.include(testEnvironment, '/business/admitted-stop-form')
    assert.include(testEnvironment, '/members/status')
  })
})
