import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const consumerCommandTimeoutMs = 10 * 60_000
const terminationGraceMs = 5_000
const finalReapGraceMs = 5_000

type ActiveCommand = {
  child: ChildProcess
  name: string
  cleanupPromise?: Promise<void>
  timeout: ReturnType<typeof setTimeout>
  timedOut: boolean
  cleanupAllowed: boolean
  spawnError?: Error
  output: string
}

export class ConsumerCommandError extends Error {
  constructor(
    readonly commandName: string,
    readonly output: string,
    readonly primaryError: unknown,
    readonly cleanupErrors: unknown[],
    readonly logPath: string
  ) {
    const details = [primaryError, ...cleanupErrors]
      .filter((error) => error !== undefined)
      .map(describeError)
    super(`${commandName} failed; see ${logPath}\n${details.join('\n')}\n${output.slice(-5000)}`)
  }
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...[...error.errors].map(describeError)].join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}

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

function signalOwnedGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    return
  }
  if (child.exitCode === null && child.signalCode === null && !child.kill(signal)) {
    throw new Error(`Could not send ${signal} to the owned consumer command.`)
  }
}

function waitForOwnedGroup(child: ChildProcess, timeoutMs: number): Promise<boolean> {
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

async function terminateOwnedGroup(child: ChildProcess): Promise<void> {
  const failures: unknown[] = []
  try {
    signalOwnedGroup(child, 'SIGTERM')
  } catch (error) {
    failures.push(error)
  }

  let stopped = false
  try {
    stopped = await waitForOwnedGroup(child, terminationGraceMs)
  } catch (error) {
    failures.push(error)
  }
  if (!stopped) {
    try {
      signalOwnedGroup(child, 'SIGKILL')
    } catch (error) {
      failures.push(error)
    }
    try {
      stopped = await waitForOwnedGroup(child, finalReapGraceMs)
    } catch (error) {
      failures.push(error)
    }
    if (!stopped)
      failures.push(new Error('The owned consumer process group did not exit after SIGKILL.'))
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Could not clean up the owned consumer process group.')
  }
}

/** Runs only harness-owned consumer commands and reaps their detached process groups. */
export class ConsumerProcessRunner {
  private active?: ActiveCommand
  private firstSignal?: NodeJS.Signals
  private signalErrors: unknown[] = []

  constructor(
    private readonly logDirectory: string,
    private readonly timeoutMs = consumerCommandTimeoutMs
  ) {}

  get interruptedBy(): NodeJS.Signals | undefined {
    return this.firstSignal
  }

  interrupt(signal: NodeJS.Signals): void {
    if (!this.firstSignal) {
      this.firstSignal = signal
      if (this.active) this.terminate(this.active)
      return
    }

    if (!this.active) return
    try {
      signalOwnedGroup(this.active.child, 'SIGKILL')
    } catch (error) {
      this.signalErrors.push(error)
    }
  }

  private terminate(active: ActiveCommand): void {
    if (active.cleanupPromise) return
    if (!active.child.pid) {
      active.cleanupPromise = Promise.resolve()
      return
    }
    active.cleanupPromise = terminateOwnedGroup(active.child)
    void active.cleanupPromise.catch(() => {})
  }

  async run(
    cwd: string,
    command: string[],
    name: string,
    env: NodeJS.ProcessEnv,
    allowAfterInterruption = false
  ): Promise<string> {
    if (this.firstSignal && !allowAfterInterruption) {
      throw new Error(`Interrupted by ${this.firstSignal}`)
    }

    console.log(`[consumer] ${name}: pnpm ${command.join(' ')}`)
    const child = spawn('pnpm', command, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const active: ActiveCommand = {
      child,
      name,
      timeout: setTimeout(() => {
        active.timedOut = true
        this.terminate(active)
      }, this.timeoutMs),
      timedOut: false,
      cleanupAllowed: allowAfterInterruption,
      output: '',
    }
    this.active = active
    child.stdout?.on('data', (chunk) => {
      active.output += chunk
    })
    child.stderr?.on('data', (chunk) => {
      active.output += chunk
    })
    child.once('error', (error) => {
      active.spawnError = error
    })

    try {
      return await new Promise<string>((resolve, reject) => {
        child.once('close', (code, signal) => {
          clearTimeout(active.timeout)
          void this.finish(active, code, signal).then(resolve, reject)
        })
      })
    } finally {
      if (this.active === active) this.active = undefined
    }
  }

  private async finish(
    active: ActiveCommand,
    code: number | null,
    signal: NodeJS.Signals | null
  ): Promise<string> {
    const cleanupErrors: unknown[] = []
    if ((active.timedOut || this.firstSignal) && !active.cleanupPromise) this.terminate(active)
    if (active.cleanupPromise) {
      try {
        await active.cleanupPromise
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    cleanupErrors.push(...this.signalErrors.splice(0))

    let primaryError: unknown
    if (active.spawnError) primaryError = active.spawnError
    else if (active.timedOut) primaryError = new Error(`timed out after ${this.timeoutMs}ms`)
    else if (this.firstSignal && !active.cleanupAllowed) {
      primaryError = new Error(`Interrupted by ${this.firstSignal}`)
    } else if (code !== 0) {
      primaryError = new Error(`exited with code ${code}, signal ${signal}`)
    }

    if (primaryError !== undefined || cleanupErrors.length) {
      const error = new ConsumerCommandError(
        active.name,
        active.output,
        primaryError,
        cleanupErrors,
        join(this.logDirectory, `${active.name}.log`)
      )
      await writeFile(
        join(this.logDirectory, `${active.name}.log`),
        `${active.output}${active.output.endsWith('\n') || !active.output ? '' : '\n'}RUNNER ERROR: ${error.message}\n`
      )
      throw error
    }
    await writeFile(join(this.logDirectory, `${active.name}.log`), active.output)
    return active.output
  }
}
