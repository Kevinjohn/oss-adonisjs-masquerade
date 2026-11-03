import { test } from '@japa/runner'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDemoCommand } from '../bin/helpers/account_kit_demo_process.js'

async function waitForPid(file: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const pid = Number(await readFile(file, 'utf8'))
      if (pid > 0) return pid
    } catch {
      // The child has not written the file yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${file}`)
}

function killOwnedGroup(pid: number): void {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('cleanup timed out')), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

test.group('Account Kit demo process', (group) => {
  let directory: string
  group.each.setup(async () => {
    directory = await mkdtemp(join(tmpdir(), 'account-kit-process-'))
    return async () => rm(directory, { recursive: true, force: true })
  })

  test('aborts an owned child and waits for its exit', async ({ assert }) => {
    const pidFile = join(directory, 'child.pid')
    const controller = new AbortController()
    const running = runDemoCommand(
      process.execPath,
      [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
      ],
      directory,
      process.env,
      controller.signal
    )
    let pid = 0
    try {
      pid = await waitForPid(pidFile)
      controller.abort()
      await assert.rejects(() => within(running, 6_000), /abort/i)
      assert.throws(() => process.kill(pid, 0), /ESRCH/)
    } finally {
      controller.abort()
      if (pid) killOwnedGroup(pid)
      await Promise.race([
        running.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ])
    }
  }).timeout(8_000)

  test('kills a descendant that ignores TERM after its parent exits', async ({ assert }) => {
    if (process.platform === 'win32') return
    const childPidFile = join(directory, 'descendant.pid')
    const parentPidFile = join(directory, 'parent.pid')
    const readyFile = join(directory, 'descendant.ready')
    const descendant = join(directory, 'descendant.ts')
    const parent = join(directory, 'parent.ts')
    await writeFile(
      descendant,
      `import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); writeFileSync(${JSON.stringify(readyFile)}, 'ready'); setInterval(() => {}, 1000);\n`
    )
    await writeFile(
      parent,
      `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(parentPidFile)}, String(process.pid)); const child = spawn(process.execPath, [${JSON.stringify(descendant)}], { stdio: 'ignore' }); writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid)); setInterval(() => {}, 1000);`
    )
    const controller = new AbortController()
    const running = runDemoCommand(
      process.execPath,
      [parent],
      directory,
      process.env,
      controller.signal
    )
    let parentPid = 0
    let childPid = 0
    try {
      parentPid = await waitForPid(parentPidFile)
      childPid = await waitForPid(childPidFile)
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          if ((await readFile(readyFile, 'utf8')) === 'ready') break
        } catch {
          // The descendant has not initialized its signal handler yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.equal(await readFile(readyFile, 'utf8'), 'ready')
      controller.abort()
      await assert.rejects(() => within(running, 6_000), /abort/i)
      assert.throws(() => process.kill(childPid, 0), /ESRCH/)
    } finally {
      controller.abort()
      if (parentPid) killOwnedGroup(parentPid)
      await Promise.race([
        running.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ])
    }
  }).timeout(10_000)

  test('escalates when the direct child ignores TERM', async ({ assert }) => {
    if (process.platform === 'win32') return
    const pidFile = join(directory, 'ignoring.pid')
    const controller = new AbortController()
    const running = runDemoCommand(
      process.execPath,
      [
        '-e',
        `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
      ],
      directory,
      process.env,
      controller.signal
    )
    let pid = 0
    try {
      pid = await waitForPid(pidFile)
      controller.abort()
      await assert.rejects(() => within(running, 5_000), /abort/i)
      assert.throws(() => process.kill(pid, 0), /ESRCH/)
    } finally {
      controller.abort()
      if (pid) killOwnedGroup(pid)
      await Promise.race([
        running.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ])
    }
  }).timeout(8_000)

  for (const exitCode of [0, 7]) {
    test(`cleans an ignoring descendant after a parent exits with ${exitCode}`, async ({
      assert,
    }) => {
      if (process.platform === 'win32') return
      const parentPidFile = join(directory, 'parent.pid')
      const childPidFile = join(directory, 'descendant.pid')
      const readyFile = join(directory, 'descendant.ready')
      const descendant = join(directory, 'descendant.ts')
      const parent = join(directory, 'parent.ts')
      await writeFile(
        descendant,
        `import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); writeFileSync(${JSON.stringify(readyFile)}, 'ready'); setInterval(() => {}, 1000);`
      )
      await writeFile(
        parent,
        `import { spawn } from 'node:child_process'; import { existsSync, writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(parentPidFile)}, String(process.pid)); const child = spawn(process.execPath, [${JSON.stringify(descendant)}], { stdio: 'ignore' }); writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid)); const check = setInterval(() => { if (existsSync(${JSON.stringify(readyFile)})) { clearInterval(check); process.exit(${exitCode}); } }, 10);`
      )
      const running = runDemoCommand(process.execPath, [parent], directory, process.env)
      let parentPid = 0
      try {
        parentPid = await waitForPid(parentPidFile)
        const childPid = await waitForPid(childPidFile)
        if (exitCode === 0) await within(running, 6_000)
        else await assert.rejects(() => within(running, 6_000), /exited with 7/)
        assert.throws(() => process.kill(childPid, 0), /ESRCH/)
      } finally {
        if (parentPid) killOwnedGroup(parentPid)
        await Promise.race([
          running.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ])
      }
    }).timeout(8_000)
  }

  test('reports a spawn error', async ({ assert }) => {
    await assert.rejects(
      () =>
        within(
          runDemoCommand(join(directory, 'missing-command'), [], directory, process.env),
          1000
        ),
      /ENOENT/
    )
  }).timeout(3_000)
})
