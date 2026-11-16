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
    let output = ''
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
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString()
      const address = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/?)/)?.[1]
      if (!address) return

      cleanup()
      stdout.resume()
      resolve(address.replace(/\/$/, ''))
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

export function stopOwnedVite(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
