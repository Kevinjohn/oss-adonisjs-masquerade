#!/usr/bin/env node
// Runs the Account Kit demo in a separate generated workspace with the pinned release package.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { childDemoEnv, readDemoEnv } from './helpers/account_kit_demo_environment.js'
import { formatDemoSchema } from './helpers/account_kit_demo_format.js'
import { groupExists, runDemoCommand, signalGroup } from './helpers/account_kit_demo_process.js'
import { validateDemoWorkspace } from './helpers/account_kit_demo_workspace.js'
import { prepare } from './helpers/prepare_account_kit_demo.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = join(root, 'tmp/account-kit-demo')
const template = join(root, 'examples/account-kit-demo/.env.example')

export function assertNodeVersion(version = process.versions.node): void {
  if (Number(version.split('.')[0]) !== 24)
    throw new Error(`The Account Kit demo requires Node.js 24; found ${version}`)
}

async function portIsFreeOn(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolvePort(false)
      else if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') resolvePort(true)
      else reject(error)
    })
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolvePort(true)))
    })
  })
}

async function assertPortAvailable(port: number): Promise<void> {
  for (const host of ['127.0.0.1', '0.0.0.0', '::', '::1']) {
    if (!(await portIsFreeOn(host, port)))
      throw new Error(`Port ${port} is already in use on ${host}. Stop its owner and retry.`)
  }
}

async function resetSqliteFiles(app: string): Promise<void> {
  const tmp = join(app, 'tmp')
  let entries: string[]
  try {
    entries = await readdir(tmp)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const name of entries) {
    if (/^db\.sqlite3(?:-(?:wal|shm|journal))?$/.test(name)) await rm(join(tmp, name))
  }
}

async function stopServerGroup(child: ChildProcess, exited: Promise<unknown>): Promise<void> {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    child.kill('SIGTERM')
    if ((await Promise.race([exited.then(() => true), delay(1_800).then(() => false)])) === false)
      child.kill('SIGKILL')
    await exited
    return
  }
  signalGroup(child.pid, 'SIGTERM')
  for (let attempt = 0; attempt < 18; attempt++) {
    if (!groupExists(child.pid)) {
      await exited
      return
    }
    await delay(100)
  }
  signalGroup(child.pid, 'SIGKILL')
  for (let attempt = 0; attempt < 18; attempt++) {
    if (!groupExists(child.pid)) {
      await exited
      return
    }
    await delay(100)
  }
  throw new Error(`Owned server process group ${child.pid} did not exit after SIGKILL`)
}

async function waitForReady(
  url: string,
  child: ChildProcess,
  exited: Promise<unknown>,
  signal: AbortSignal
): Promise<void> {
  const deadline = Date.now() + 120_000
  let serverStopped = false
  const stopped = exited.then(
    () => {
      serverStopped = true
      throw new Error('The Account Kit demo server exited before it became ready')
    },
    (error: unknown) => {
      serverStopped = true
      throw error
    }
  )
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('The Account Kit demo server exited before it became ready')
    try {
      const page = (async () => {
        const response = await fetch(`${url}/login`, {
          redirect: 'manual',
          signal: AbortSignal.any([signal, AbortSignal.timeout(1_200)]),
        })
        return { status: response.status, body: await response.text() }
      })()
      const { status, body } = await Promise.race([page, stopped])
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('The Account Kit demo server exited before it became ready')
      if (status === 200 && body.includes('data-demo="account-kit"')) return
    } catch (error) {
      if (signal.aborted || serverStopped) throw error
    }
    await Promise.race([delay(250, undefined, { signal }), stopped])
  }
  throw new Error('The Account Kit demo did not become ready within 120 seconds')
}

export async function runAccountKitDemo(): Promise<void> {
  assertNodeVersion()
  const cliArgs = process.argv.slice(2)
  if (
    cliArgs.some((arg) => arg !== '--reset') ||
    cliArgs.filter((arg) => arg === '--reset').length > 1
  )
    throw new Error('Expected no arguments or --reset')
  const reset = cliArgs.includes('--reset')
  const controller = new AbortController()
  let interrupted: 'SIGINT' | 'SIGTERM' | undefined
  let server: ChildProcess | undefined
  let serverExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined
  let serverCleanup: Promise<void> | undefined
  const stopServer = () => {
    if (server && serverExit) serverCleanup ??= stopServerGroup(server, serverExit)
    return serverCleanup
  }
  const interrupt = (name: 'SIGINT' | 'SIGTERM') => {
    if (interrupted) return
    interrupted = name
    controller.abort()
    void stopServer()?.catch(() => {})
  }
  const onInt = () => interrupt('SIGINT')
  const onTerm = () => interrupt('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)
  try {
    const location = await validateDemoWorkspace(workspace)
    const existing = await readDemoEnv(join(location, 'app/.env'))
    const prospective = existing ?? (await readDemoEnv(template))
    if (!prospective)
      throw new Error(`Account Kit demo environment template is missing: ${template}`)
    const port = Number(process.env.PORT ?? prospective.PORT ?? '3335')
    if (!existing) {
      prospective.PORT = String(port)
      prospective.APP_URL = `http://127.0.0.1:${port}`
    }
    childDemoEnv(prospective, process.env, port)
    await assertPortAvailable(port)
    controller.signal.throwIfAborted()
    if (reset) await resetSqliteFiles(join(location, 'app'))
    const prepared = await prepare(location, { port, signal: controller.signal })
    await runDemoCommand(
      process.execPath,
      ['ace.js', 'migration:run'],
      prepared.app,
      prepared.env,
      controller.signal
    )
    await runDemoCommand(
      process.execPath,
      ['ace.js', 'codegen'],
      prepared.app,
      prepared.env,
      controller.signal
    )
    await formatDemoSchema(prepared.app, prepared.env, controller.signal)
    await runDemoCommand(
      process.execPath,
      ['ace.js', 'demo:kit-seed'],
      prepared.app,
      prepared.env,
      controller.signal
    )
    await assertPortAvailable(port)
    controller.signal.throwIfAborted()
    server = spawn(process.execPath, ['ace.js', 'serve'], {
      cwd: prepared.app,
      env: prepared.env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    })
    serverExit = new Promise((resolveExit, reject) => {
      server!.once('error', reject)
      server!.once('exit', (code, signal) => resolveExit({ code, signal }))
    })
    await waitForReady(prepared.url, server, serverExit, controller.signal)
    controller.signal.throwIfAborted()
    console.log(`\nAccount Kit demo ready: ${prepared.url}`)
    console.log('Sign in with the fictional local operator account:')
    console.log('  operator@example.test / demo-operator-2026')
    console.log('Press Ctrl+C to stop the demo.')
    const result = await serverExit
    if (!interrupted && result.code !== 0)
      throw new Error(`The Account Kit demo server exited with ${result.code ?? result.signal}`)
  } catch (error) {
    if (!interrupted) throw error
  } finally {
    controller.abort()
    try {
      if (stopServer()) await serverCleanup
    } finally {
      process.off('SIGINT', onInt)
      process.off('SIGTERM', onTerm)
      if (interrupted) process.exitCode = interrupted === 'SIGINT' ? 130 : 143
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAccountKitDemo().catch((error) => {
    console.error(`Account Kit demo failed: ${(error as Error).message}`)
    if (process.exitCode !== 130 && process.exitCode !== 143) process.exitCode = 1
  })
}
