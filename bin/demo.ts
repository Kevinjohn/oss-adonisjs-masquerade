#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { realpathSync } from 'node:fs'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const example = path.join(root, 'examples/native-session')
const envPath = path.join(example, '.env')
const envExamplePath = path.join(example, '.env.example')
const exampleLockPath = path.join(example, 'pnpm-lock.yaml')
const tarballPath = path.join(root, 'tmp/native-session-package.tgz')
const reservedEmails = [
  'operator@example.test',
  'customer-one@example.test',
  'customer-two@example.test',
]
const reservedPasswords = ['demo-operator-2026', 'demo-customer-one-2026', 'demo-customer-two-2026']
const children = new Set<ChildProcess>()
const abandonChildren = new Map<ChildProcess, (error: unknown) => void>()
const ownedGroups = new Set<number>()
const groupCleanupPromises = new Map<number, Promise<void>>()
let interruptedBy: NodeJS.Signals | null = null
let cleanupPromise: Promise<void> | null = null

export function assertNodeVersion(version: string = process.versions.node): void {
  const major = Number(version.split('.')[0])
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(
      `The demo requires Node.js 24 or newer; found ${version}. Use the version in .nvmrc, then rerun pnpm demo.`
    )
  }
}

function parseEnv(source: string, filePath: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) {
      throw new Error(
        `${filePath}:${index + 1} is malformed; expected NAME=value. Fix it and retry.`
      )
    }
    let value = match[2].trim()
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]
      if (value.at(-1) !== quote || value.length < 2) {
        throw new Error(
          `${filePath}:${index + 1} has an unterminated quoted value. Fix it and retry.`
        )
      }
      value = value.slice(1, -1)
      if (quote === '"')
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    result.set(match[1], value)
  }
  return result
}

async function effectiveEnv() {
  let source
  let createdEnv = false
  try {
    source = await readFile(envPath, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await copyFile(envExamplePath, envPath)
    source = await readFile(envPath, 'utf8')
    createdEnv = true
  }

  const fileValues = parseEnv(source, envPath)
  const environment = { ...Object.fromEntries(fileValues), ...process.env }
  if (environment.NODE_ENV === 'production') {
    throw new Error(
      'The demo refuses NODE_ENV=production. Set NODE_ENV=development in examples/native-session/.env and retry.'
    )
  }
  if (environment.NODE_ENV === 'test') {
    throw new Error(
      'The demo requires NODE_ENV=development. Change examples/native-session/.env and retry.'
    )
  }
  if (environment.DB_CLIENT && environment.DB_CLIENT !== 'sqlite') {
    throw new Error(
      `The demo requires SQLite, but DB_CLIENT=${environment.DB_CLIENT}. Remove it or set DB_CLIENT=sqlite before retrying.`
    )
  }
  const port = Number(environment.PORT ?? '3333')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `PORT must be a valid TCP port from 1 to 65535; found ${environment.PORT ?? ''}.`
    )
  }
  environment.PORT = String(port)
  if (environment.APP_URL === 'http://${HOST}:${PORT}') {
    const appUrlHost = environment.HOST ?? '127.0.0.1'
    environment.APP_URL = `http://${appUrlHost}:${port}`
    if (createdEnv) {
      source = source.replace(/^APP_URL=.*$/m, `APP_URL=${environment.APP_URL}`)
      await writeFile(envPath, source)
    }
  }
  try {
    if (!environment.APP_URL) throw new Error('missing')
    const appUrl = new URL(environment.APP_URL)
    if (!['http:', 'https:'].includes(appUrl.protocol)) throw new Error('unsupported protocol')
  } catch {
    throw new Error(
      `APP_URL in ${envPath} must be a valid http or https URL. Correct the existing setting and retry.`
    )
  }
  return {
    environment,
    needsKey:
      !environment.APP_KEY || environment.APP_KEY === 'replace_me_with_node_ace_generate_key',
  }
}

function processGroupExists(groupId: number): boolean {
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

function combineErrors(primary: unknown, cleanupErrors: unknown[]): unknown {
  if (cleanupErrors.length === 0) return primary
  const errors = primary === undefined ? cleanupErrors : [primary, ...cleanupErrors]
  return new AggregateError(errors, 'The operation failed and cleanup also failed.')
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...[...error.errors].map(describeError)].join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}

function waitForProcessGroupExit(groupId: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = setInterval(() => {
      try {
        if (!processGroupExists(groupId)) {
          clearInterval(poll)
          ownedGroups.delete(groupId)
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

function cleanupProcessGroup(groupId: number | undefined): Promise<void> {
  if (!groupId || process.platform === 'win32') return Promise.resolve()
  const existing = groupCleanupPromises.get(groupId)
  if (existing) return existing

  const cleanup = (async () => {
    if (!processGroupExists(groupId)) {
      ownedGroups.delete(groupId)
      return
    }
    try {
      process.kill(-groupId, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    if (await waitForProcessGroupExit(groupId, 1800)) return
    try {
      process.kill(-groupId, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    if (!(await waitForProcessGroupExit(groupId, 1800))) {
      throw new Error(`Failed to reap owned process group ${groupId} after SIGKILL.`)
    }
  })()
  groupCleanupPromises.set(groupId, cleanup)
  void cleanup.then(
    () => groupCleanupPromises.delete(groupId),
    () => undefined
  )
  return cleanup
}

function cleanupOwnedProcesses(): Promise<void> {
  if (cleanupPromise) return cleanupPromise
  if (ownedGroups.size === 0 && children.size === 0) {
    cleanupPromise = Promise.resolve()
    return cleanupPromise
  }
  cleanupPromise = (async () => {
    const failures: unknown[] = []
    const groupResults = await Promise.allSettled([...ownedGroups].map(cleanupProcessGroup))
    for (const result of groupResults) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (process.platform === 'win32') {
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue
        try {
          if (!child.kill('SIGTERM') && child.exitCode === null && child.signalCode === null) {
            failures.push(
              new Error(`Failed to signal child process ${child.pid ?? 'with unknown pid'}.`)
            )
          }
        } catch (error) {
          failures.push(error)
        }
      }
      const deadline = Date.now() + 1800
      while (
        [...children].some((child) => child.exitCode === null && child.signalCode === null) &&
        Date.now() < deadline
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 40))
      }
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL')
          } catch (error) {
            failures.push(error)
          }
        }
      }
      const finalDeadline = Date.now() + 1800
      while (
        [...children].some((child) => child.exitCode === null && child.signalCode === null) &&
        Date.now() < finalDeadline
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 40))
      }
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          failures.push(
            new Error(`Failed to reap child process ${child.pid ?? 'with unknown pid'}.`)
          )
        }
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Failed to clean up owned processes.')
  })()
  return cleanupPromise
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  if (interruptedBy) return Promise.reject(new Error(`Interrupted by ${interruptedBy}`))
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      shell: false,
    })
    children.add(child)
    if (process.platform !== 'win32' && child.pid) ownedGroups.add(child.pid)
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      abandonChildren.delete(child)
      if (error) reject(error)
      else resolve()
    }
    abandonChildren.set(child, (error) => {
      child.unref()
      children.delete(child)
      finish(combineErrors(new Error(`Interrupted by ${interruptedBy}`), [error]))
    })
    child.once('error', async (error) => {
      children.delete(child)
      try {
        await cleanupProcessGroup(child.pid)
      } catch (cleanupError) {
        finish(combineErrors(error, [cleanupError]))
        return
      }
      finish(error)
    })
    child.once('exit', async (code, signal) => {
      children.delete(child)
      let commandError: Error | undefined
      try {
        await cleanupProcessGroup(child.pid)
      } catch (cleanupError) {
        if (interruptedBy) commandError = new Error(`Interrupted by ${interruptedBy}`)
        else if (code !== 0)
          commandError = new Error(
            `${path.basename(command)} ${args.join(' ')} exited ${signal ? `on ${signal}` : `with code ${code}`}.`
          )
        finish(combineErrors(commandError, [cleanupError]))
        return
      }
      if (interruptedBy) finish(new Error(`Interrupted by ${interruptedBy}`))
      else if (code === 0) finish()
      else
        finish(
          new Error(
            `${path.basename(command)} ${args.join(' ')} exited ${signal ? `on ${signal}` : `with code ${code}`}.`
          )
        )
    })
  })
}

function portIsFreeOn(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') resolve(false)
      // The host has no such address family, so nothing can hold the port there.
      else if (code && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(code)) resolve(true)
      else reject(error)
    })
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve(true)))
    })
  })
}

// `node ace serve` moves to a random port when any local address holds the configured one, so
// a listener on the wildcard or IPv6 addresses must count as busy too.
async function assertPortAvailable(port: number): Promise<void> {
  for (const host of ['127.0.0.1', '0.0.0.0', '::', '::1']) {
    if (!(await portIsFreeOn(host, port))) {
      throw new Error(
        `Port ${port} is already in use on ${host}. Stop its owner or choose another PORT in examples/native-session/.env, then retry.`
      )
    }
  }
}

async function refreshLocalTarballIntegrity() {
  const [lockfile, tarball] = await Promise.all([
    readFile(exampleLockPath, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error
      throw new Error(
        'The native-session example is missing pnpm-lock.yaml; restore it before retrying.'
      )
    }),
    readFile(tarballPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      throw new Error(
        'The local package tarball was not created. Run `pnpm pack:fixture` from the repository root and retry.'
      )
    }),
  ])
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  const localResolution =
    /( {2}'@kevinjohn\/adonisjs-masquerade@file:\.\.\/\.\.\/tmp\/native-session-package\.tgz':\n {4}resolution: \{integrity: )sha512-[A-Za-z0-9+/=]+(, tarball: file:\.\.\/\.\.\/tmp\/native-session-package\.tgz\s*\})/g
  const matches = [...lockfile.matchAll(localResolution)]
  if (matches.length !== 1) {
    throw new Error(
      `Expected one local @kevinjohn/adonisjs-masquerade tarball integrity entry in ${exampleLockPath}, found ${matches.length}. Restore the example lockfile before retrying.`
    )
  }
  const updated = lockfile.replace(localResolution, `$1${integrity}$2`)
  if (updated !== lockfile) await writeFile(exampleLockPath, updated)
}

async function waitForDemo(
  port: number,
  serverChild: ChildProcess,
  getSpawnError: () => NodeJS.ErrnoException | undefined
): Promise<string> {
  const url = `http://127.0.0.1:${port}/`
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (interruptedBy) throw new Error(`Interrupted by ${interruptedBy}`)
    const spawnError = getSpawnError()
    if (spawnError)
      throw new Error(
        `Could not start the demo server: ${spawnError.message}. Check that pnpm is installed and on PATH.`
      )
    if (serverChild.exitCode !== null || serverChild.signalCode !== null) {
      throw new Error(
        'The demo server exited before becoming ready. Run `pnpm demo` again and inspect the server error above.'
      )
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200), redirect: 'manual' })
      const body = await response.text()
      if (
        response.status === 200 &&
        body.includes('Server ready') &&
        body.includes('Welcome to the power of a Hypermedia app.')
      )
        return url
    } catch {
      // The server may still be starting or the port may have briefly reset.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    'The demo server did not return its expected application page within 30 seconds. Check the server output, then retry `pnpm demo`.'
  )
}

async function startServer(environment: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn('pnpm', ['dev'], {
    cwd: example,
    env: { ...environment, HOST: '127.0.0.1' },
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    shell: false,
  })
  children.add(child)
  if (process.platform !== 'win32' && child.pid) ownedGroups.add(child.pid)
  const exitPromise = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    error?: Error
  }>((resolve) => {
    abandonChildren.set(child, (error) => {
      child.unref()
      children.delete(child)
      resolve({
        code: null,
        signal: null,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    })
    child.once('error', (error) => resolve({ code: null, signal: null, error }))
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  let spawnError: NodeJS.ErrnoException | undefined
  let cleanupError: unknown
  child.once('error', (error) => {
    spawnError = error
    children.delete(child)
  })
  const exitCleanup = exitPromise.then(async () => {
    children.delete(child)
    abandonChildren.delete(child)
    try {
      await cleanupProcessGroup(child.pid)
    } catch (error) {
      cleanupError = error
    }
  })
  let url: string
  try {
    url = await waitForDemo(Number(environment.PORT), child, () => spawnError)
  } catch (error) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) {
      await exitCleanup
      throw combineErrors(error, cleanupError === undefined ? [] : [cleanupError])
    }
    throw error
  }
  console.log(`\nDemo ready: ${url}`)
  console.log('Sign in with the fictional local operator account:')
  console.log(`  ${reservedEmails[0]} / ${reservedPasswords[0]}`)
  console.log(
    'After starting support mode, open the customer page, change its reversible preference, then stop support mode.'
  )
  console.log('Press Ctrl+C to stop the demo.')
  const result = await exitPromise
  await exitCleanup
  let exitError: Error | undefined
  if (result.error)
    exitError = new Error(`Could not start the demo server: ${result.error.message}.`)
  else if (!interruptedBy && result.code !== 0)
    exitError = new Error('The demo server stopped unexpectedly.')
  if (interruptedBy) exitError = new Error(`Interrupted by ${interruptedBy}`)
  if (exitError || cleanupError !== undefined) {
    throw combineErrors(exitError, cleanupError === undefined ? [] : [cleanupError])
  }
}

async function ensureFiles() {
  await access(path.join(root, 'pnpm-lock.yaml')).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    throw new Error(
      'Run this command from a complete repository checkout containing pnpm-lock.yaml.'
    )
  })
  await access(envExamplePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    throw new Error(
      `The native-session example is missing its configuration template: ${envExamplePath}`
    )
  })
  await mkdir(path.dirname(tarballPath), { recursive: true })
}

export async function runDemo() {
  assertNodeVersion()
  await ensureFiles()
  let { environment, needsKey } = await effectiveEnv()
  if (environment.NODE_ENV !== 'development') {
    throw new Error(
      `The demo requires NODE_ENV=development; found ${environment.NODE_ENV ?? 'unset'}. Set it in examples/native-session/.env and retry.`
    )
  }
  await assertPortAvailable(Number(environment.PORT))

  const pnpm = 'pnpm'
  await run(pnpm, ['install', '--frozen-lockfile'])
  await run(pnpm, ['build'])
  await run(pnpm, ['pack:fixture'])
  await refreshLocalTarballIntegrity()
  await run(pnpm, ['install', '--frozen-lockfile'], { cwd: example })

  if (needsKey) {
    await run(process.execPath, ['ace', 'generate:key'], {
      cwd: example,
      env: { ...environment, HOST: '127.0.0.1' },
    })
    const refreshed = await effectiveEnv()
    environment = refreshed.environment
    if (refreshed.needsKey)
      throw new Error(
        'AdonisJS did not write APP_KEY to examples/native-session/.env. Run `node ace generate:key` there, then retry.'
      )
  }
  if (
    environment.NODE_ENV !== 'development' ||
    (environment.DB_CLIENT && environment.DB_CLIENT !== 'sqlite')
  ) {
    throw new Error(
      'The effective demo configuration changed during setup. Restore development with SQLite in examples/native-session/.env, then retry.'
    )
  }

  const childEnv = { ...environment, HOST: '127.0.0.1' }
  await run(process.execPath, ['ace', 'migration:run'], { cwd: example, env: childEnv })
  await run(process.execPath, ['ace', 'demo:seed'], { cwd: example, env: childEnv })
  // Setup can take minutes; another application may have taken the port meanwhile.
  await assertPortAvailable(Number(environment.PORT))
  await startServer(childEnv)
}

const invokedPath = process.argv[1]
if (invokedPath && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (interruptedBy) return
      interruptedBy = signal
      void cleanupOwnedProcesses()
        .catch((error) => {
          for (const abandon of abandonChildren.values()) abandon(error)
          console.error(`Demo cleanup failed: ${describeError(error)}`)
        })
        .finally(() => {
          process.exitCode = signal === 'SIGINT' ? 130 : 143
        })
    })
  }

  runDemo().catch(async (error) => {
    let failure = error
    try {
      await cleanupOwnedProcesses()
    } catch (cleanupError) {
      failure = combineErrors(error, [cleanupError])
    }
    if (interruptedBy) process.exitCode = interruptedBy === 'SIGINT' ? 130 : 143
    else {
      console.error(`Demo setup failed: ${describeError(failure)}`)
      process.exitCode = 1
    }
  })
}
