import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

export const viteArguments = ['exec', 'vite', '--host', '127.0.0.1', '--port', '0'] as const

export function spawnVite(cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn('pnpm', [...viteArguments], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true,
  })
}

export function waitForViteAddress(child: ChildProcess): Promise<string> {
  if (!child.stdout) throw new Error('Vite stdout is unavailable')
  if (child.exitCode !== null || child.signalCode !== null)
    throw new Error('Vite exited before becoming ready')

  return new Promise((resolve, reject) => {
    let pendingLine = ''
    const stdout = child.stdout as Readable
    const timeout = setTimeout(() => fail(new Error('Vite did not report its address')), 30_000)

    const cleanup = () => {
      clearTimeout(timeout)
      stdout.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onLine = (line: string) => {
      const match = line.match(/Local:\s+(http:\/\/127\.0\.0\.1:(\d+)\/?)[ \t]*$/)
      if (!match) return false

      const port = Number(match[2])
      if (!Number.isInteger(port) || port < 1 || port > 65535) return false

      cleanup()
      stdout.resume()
      resolve(match[1].replace(/\/$/, ''))
      return true
    }
    const onData = (chunk: Buffer | string) => {
      const output = pendingLine + chunk.toString()
      let start = 0
      let newline = output.indexOf('\n')
      while (newline !== -1) {
        if (onLine(output.slice(start, newline).replace(/\r$/, ''))) return
        start = newline + 1
        newline = output.indexOf('\n', start)
      }

      pendingLine = output.slice(start).slice(-4096)
    }
    const onError = (error: Error) => fail(error)
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(new Error(`Vite exited before becoming ready (${code ?? signal})`))
    }

    stdout.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

export async function waitForViteReady(child: ChildProcess): Promise<string> {
  const address = await waitForViteAddress(child)
  if (childExit(child)) throw new Error('Vite exited before becoming ready')

  const response = await fetch(new URL('/@vite/client', address), {
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Vite health check failed (${response.status})`)
  if (childExit(child)) throw new Error('Vite exited before becoming ready')

  return address
}

export function stopOwnedProcessGroup(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

type ChildExit = { code: number | null; signal: NodeJS.Signals | null } | { error: Error }

function childExit(child: ChildProcess): ChildExit | null {
  if (child.exitCode !== null || child.signalCode !== null)
    return { code: child.exitCode, signal: child.signalCode }
  return null
}

function exitDescription(exit: ChildExit): string {
  if ('error' in exit) return exit.error.message
  return exit.code === null ? (exit.signal ?? 'unknown') : String(exit.code)
}

function waitForExit(child: ChildProcess): Promise<ChildExit> {
  const currentExit = childExit(child)
  if (currentExit) return Promise.resolve(currentExit)

  return new Promise((resolve) => {
    const onError = (error: Error) => {
      child.off('exit', onExit)
      resolve({ error })
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      child.off('error', onError)
      resolve({ code, signal })
    }
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function waitForCommand(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      child.off('close', onClose)
      reject(error)
    }
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      child.off('error', onError)
      if (code === 0) resolve()
      else reject(new Error(`${label} failed (${code ?? signal})`))
    }
    child.once('error', onError)
    child.once('close', onClose)
  })
}

export async function runWithOwnedVite(
  vite: ChildProcess,
  label: string,
  startCommand: () => ChildProcess
): Promise<void> {
  if (childExit(vite)) throw new Error(`Vite exited before ${label} started`)

  const viteExit = waitForExit(vite)
  const command = startCommand()
  const commandExit = waitForCommand(command, label)
  const outcome = await Promise.race([
    commandExit.then(() => ({ kind: 'command' as const })),
    viteExit.then((exit) => ({ kind: 'vite' as const, exit })),
  ])

  if (outcome.kind === 'command') return

  try {
    stopOwnedProcessGroup(command)
  } catch (error) {
    console.error(`Could not stop ${label} after Vite exited:`, error)
  }
  await commandExit.catch(() => {})
  throw new Error(`Vite exited during ${label} (${exitDescription(outcome.exit)})`)
}
