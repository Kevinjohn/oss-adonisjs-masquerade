import { cleanupFailure } from './operation_failures.js'
import type { ChildProcess } from 'node:child_process'

const termGraceMs = 5000
const reapGraceMs = 5000

function groupExists(groupId: number): boolean {
  try {
    process.kill(-groupId, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM') return true
    if (code === 'ESRCH') return false
    throw error
  }
}

export function signalOwnedProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    return
  }
  if (child.exitCode === null && child.signalCode === null && !child.kill(signal)) {
    throw new Error(`Could not send ${signal} to the owned child process.`)
  }
}

function waitForOwnedProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = setInterval(() => {
      try {
        const exists =
          process.platform !== 'win32' && child.pid
            ? groupExists(child.pid)
            : child.exitCode === null && child.signalCode === null
        if (!exists) {
          clearInterval(poll)
          resolve(true)
        } else if (Date.now() >= deadline) {
          clearInterval(poll)
          resolve(false)
        }
      } catch (error) {
        clearInterval(poll)
        reject(error)
      }
    }, 40)
  })
}

export async function terminateOwnedProcess(child: ChildProcess): Promise<void> {
  const failures: unknown[] = []
  try {
    signalOwnedProcess(child, 'SIGTERM')
  } catch (error) {
    failures.push(error)
  }

  let stopped = false
  try {
    stopped = await waitForOwnedProcessExit(child, termGraceMs)
  } catch (error) {
    failures.push(error)
  }
  if (!stopped) {
    try {
      signalOwnedProcess(child, 'SIGKILL')
    } catch (error) {
      failures.push(error)
    }
    try {
      stopped = await waitForOwnedProcessExit(child, reapGraceMs)
    } catch (error) {
      failures.push(error)
    }
    if (!stopped) failures.push(new Error('The owned process group did not exit after SIGKILL.'))
  }
  if (failures.length) throw cleanupFailure(failures, 'Could not clean up the owned process group.')
}
