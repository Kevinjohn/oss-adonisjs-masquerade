import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { test } from '@japa/runner'
import {
  runWithOwnedVite,
  stopOwnedProcessGroup,
  viteArguments,
  waitForViteAddress,
  waitForViteReady,
} from '../../bin/helpers/owned_vite.js'

function controlledProcess(pid: number): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
  }) as ChildProcess
}

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
      const address = await waitForViteReady(child)
      assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/)
      assert.notEqual(new URL(address).port, '5173')
      assert.equal(await fetch(address).then((response) => response.text()), 'owned')
    } finally {
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve()
        child.once('close', () => resolve())
        child.kill('SIGTERM')
      })
    }
  })

  test('waits for the complete address line when stdout splits the port', async () => {
    const child = controlledProcess(12344)
    const stdout = new PassThrough()
    child.stdout = stdout
    let ready = false
    const addressReady = waitForViteAddress(child).then((address) => {
      ready = true
      return address
    })

    stdout.write('  Local:   http://127.0.0.1:517')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(ready, false)

    stdout.write('3/\n')
    assert.equal(await addressReady, 'http://127.0.0.1:5173')
    stdout.destroy()
  })

  test('does not signal an already-exited child process group', () => {
    const originalKill = process.kill
    const signals: number[] = []
    process.kill = ((pid: number) => {
      signals.push(pid)
      return true
    }) as typeof process.kill

    try {
      stopOwnedProcessGroup({ pid: 12345, exitCode: 0, signalCode: null } as ChildProcess)
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
        stopOwnedProcessGroup({ pid: 12345, exitCode: null, signalCode: null } as ChildProcess)
      )
    } finally {
      process.kill = originalKill
    }
  })

  test('fails and stops the test process if Vite exits after readiness', async () => {
    const vite = controlledProcess(12345)
    const command = controlledProcess(12346)
    const stdout = new PassThrough()
    vite.stdout = stdout
    const originalKill = process.kill
    const signals: number[] = []
    process.kill = ((pid: number) => {
      signals.push(pid)
      return true
    }) as typeof process.kill

    try {
      const readiness = waitForViteAddress(vite)
      stdout.write('  Local:   http://127.0.0.1:4173/\n')
      assert.equal(await readiness, 'http://127.0.0.1:4173')

      const result = runWithOwnedVite(vite, 'test', () => command)
      Object.assign(vite, { exitCode: 1 })
      vite.emit('exit', 1, null)
      command.emit('close', null, 'SIGTERM')
      await assert.rejects(result, /Vite exited during test \(1\)/)
      assert.deepEqual(signals, [-12346])
    } finally {
      stdout.destroy()
      process.kill = originalKill
    }
  })

  test('preserves a test command failure when it finishes before Vite exits', async () => {
    const vite = controlledProcess(12345)
    const command = controlledProcess(12346)
    const result = runWithOwnedVite(vite, 'test', () => command)
    command.emit('close', 9, null)
    await assert.rejects(result, /test failed \(9\)/)
  })
})
