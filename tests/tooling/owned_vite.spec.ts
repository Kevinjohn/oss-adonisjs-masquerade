import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { test } from '@japa/runner'
import { stopOwnedVite, viteArguments, waitForViteAddress } from '../../bin/helpers/owned_vite.js'

test.group('owned Vite readiness', () => {
  test('starts Vite on a dynamic loopback port', () => {
    assert.deepEqual(viteArguments, ['exec', 'vite', '--host', '127.0.0.1', '--port', '0'])
  })

  test('waits for the spawned process to report its own dynamic address', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const { createServer } = require('node:http'); const server = createServer((_, res) => res.end('owned')); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); console.log('  Local:   http://127.0.0.1:' + port + '/'); });`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )

    try {
      const address = await waitForViteAddress(child)
      assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/)
      assert.notEqual(new URL(address).port, '5173')
      assert.equal(await fetch(address).then((response) => response.text()), 'owned')
    } finally {
      child.kill('SIGTERM')
    }
  })

  test('does not signal an already-exited child process group', () => {
    const originalKill = process.kill
    const signals: number[] = []
    process.kill = ((pid: number) => {
      signals.push(pid)
      return true
    }) as typeof process.kill

    try {
      stopOwnedVite({ pid: 12345, exitCode: 0, signalCode: null } as ChildProcess)
      assert.deepEqual(signals, [])
    } finally {
      process.kill = originalKill
    }
  })

  test('ignores a process group that disappears between the liveness check and signal', () => {
    const originalKill = process.kill
    process.kill = (() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    }) as typeof process.kill

    try {
      assert.doesNotThrow(() =>
        stopOwnedVite({ pid: 12345, exitCode: null, signalCode: null } as ChildProcess)
      )
    } finally {
      process.kill = originalKill
    }
  })
})
