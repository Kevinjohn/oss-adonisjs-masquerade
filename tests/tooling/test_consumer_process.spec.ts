import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from '@japa/runner'
import { fileURLToPath } from 'node:url'
import {
  ConsumerCommandError,
  ConsumerProcessRunner,
  consumerCommandTimeoutMs,
} from '../../bin/helpers/consumer_process.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const consumerRunnerPath = path.join(repoRoot, 'bin/test_consumer.ts')
const processHelperPath = path.join(repoRoot, 'bin/helpers/consumer_process.ts')
const artifactHelperPath = path.join(repoRoot, 'bin/helpers/consumer_artifact.ts')

type FixtureOptions = {
  mode?: 'normal' | 'late-output' | 'hang' | 'timeout' | 'silent-descendant'
  hook?: 'record-term' | 'fail-reap'
  failStartupLog?: boolean
  holdWorkerReady?: boolean
  externalPostgres?: boolean
}

type Fixture = {
  directory: string
  root: string
  bin: string
  commands: string
  ready: string
  started: string
  release: string
  termSent: string
  env: NodeJS.ProcessEnv
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'masquerade-consumer-process-'))
  const root = path.join(directory, 'checkout')
  const bin = path.join(directory, 'bin')
  const app = path.join(root, 'examples/native-session')
  const pkg = path.join(directory, 'package')
  const artifact = path.join(root, 'tmp/package.tgz')
  const commands = path.join(directory, 'commands.log')
  const ready = path.join(directory, 'worker-ready')
  const started = path.join(directory, 'worker-started')
  const release = path.join(directory, 'release-worker')
  const termSent = path.join(directory, 'term-sent')
  await writeFile(commands, '')
  await mkdir(path.join(root, 'bin/helpers'), { recursive: true })
  await mkdir(path.join(root, 'tmp'), { recursive: true })
  await mkdir(bin)
  await mkdir(path.join(app, 'app/middleware'), { recursive: true })
  await mkdir(path.join(app, 'app/services'), { recursive: true })
  await mkdir(path.join(app, 'config'))
  await mkdir(path.join(app, 'database/migrations'), { recursive: true })
  await mkdir(path.join(app, 'providers'))
  await mkdir(path.join(app, 'start'))
  await mkdir(path.join(app, 'bin'))
  await mkdir(pkg, { recursive: true })
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n')
  await symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  await writeFile(path.join(root, 'bin/test_consumer.ts'), await readFile(consumerRunnerPath))
  await writeFile(
    path.join(root, 'bin/helpers/consumer_process.ts'),
    await readFile(processHelperPath)
  )
  await writeFile(
    path.join(root, 'bin/helpers/consumer_artifact.ts'),
    await readFile(artifactHelperPath)
  )

  const peers = {
    '@adonisjs/core': '^7.0.0',
    '@adonisjs/auth': '^10.0.0',
    '@adonisjs/bouncer': '^4.0.0',
    '@adonisjs/lucid': '^22.4.2',
    '@adonisjs/session': '^8.1.0',
    'typescript': '^5.9.3',
  }
  await writeFile(
    path.join(pkg, 'package.json'),
    JSON.stringify({
      name: '@kevinjohn/adonisjs-masquerade',
      version: '0.1.5',
      peerDependencies: peers,
    })
  )
  execFileSync('tar', ['-czf', artifact, '-C', directory, 'package'])

  const appManifest = {
    name: 'synthetic-consumer',
    type: 'module',
    imports: {},
    dependencies: {
      '@adonisjs/core': '7.0.0',
      '@adonisjs/auth': '10.0.0',
      '@adonisjs/bouncer': '4.0.0',
      '@adonisjs/lucid': '22.4.2',
      '@adonisjs/session': '8.1.0',
      '@adonisjs/vite': '6.0.1',
      '@kevinjohn/adonisjs-masquerade': 'file:./package.tgz',
    },
    devDependencies: { typescript: '5.9.3' },
    allowScripts: {},
  }
  await writeFile(path.join(app, 'package.json'), JSON.stringify(appManifest, null, 2))
  await writeFile(path.join(app, 'tsconfig.json'), '{}\n')
  await writeFile(path.join(app, 'adonisrc.ts'), 'export default {}\n')
  await writeFile(path.join(app, 'ace.js'), 'export {}\n')
  await writeFile(path.join(app, 'bin/console.ts'), 'export {}\n')
  await writeFile(path.join(app, 'start/env.ts'), 'export {}\n')
  await writeFile(path.join(app, 'config/masquerade.ts'), 'export default {}\n')
  await writeFile(path.join(app, 'database/migrations/initial.ts'), 'export {}\n')
  await writeFile(path.join(app, 'providers/masquerade_native_provider.ts'), 'export {}\n')
  await writeFile(path.join(app, 'app/middleware/masquerade_context_middleware.ts'), 'export {}\n')

  await writeFile(
    path.join(app, 'late-output.js'),
    `import { readFile, writeFile } from 'node:fs/promises'\nawait writeFile(${JSON.stringify(ready)}, 'late-output')\nwhile (!await readFile(${JSON.stringify(release)}, 'utf8').catch(() => '')) await new Promise((resolve) => setTimeout(resolve, 20))\nconsole.log('2 passed after output barrier')\n`
  )
  await writeFile(
    path.join(app, 'term-resistant.js'),
    `import { readFile, writeFile } from 'node:fs/promises'\nprocess.on('SIGTERM', () => {})\n${
      options.holdWorkerReady
        ? `await writeFile(${JSON.stringify(started)}, String(process.pid))\nwhile (!await readFile(${JSON.stringify(release)}, 'utf8').catch(() => '')) await new Promise((resolve) => setTimeout(resolve, 20))\n`
        : ''
    }await writeFile(${JSON.stringify(ready)}, String(process.pid))\nsetInterval(() => {}, 1000)\n`
  )

  const fakePnpm = `#!${process.execPath}
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const args = process.argv.slice(2)
await writeFile(${JSON.stringify(commands)}, (await readFile(${JSON.stringify(commands)}, 'utf8')) + args.join(' ') + '\\n')
if (args[0] === 'install') {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const packages = { ...manifest.dependencies, ...manifest.devDependencies }
  for (const [name, requested] of Object.entries(packages)) {
    const versions = { '@adonisjs/core': '7.0.0', '@adonisjs/auth': '10.0.0', '@adonisjs/bouncer': '4.0.0', '@adonisjs/lucid': '22.4.2', '@adonisjs/session': '8.1.0', '@adonisjs/vite': '6.0.1', '@kevinjohn/adonisjs-masquerade': '0.1.5', typescript: '5.9.3' }
    const packagePath = path.join('node_modules', name, 'package.json')
    await mkdir(path.dirname(packagePath), { recursive: true })
    await writeFile(packagePath, JSON.stringify({ name, version: versions[name] || requested }))
  }
  const semver = 'node_modules/.pnpm/semver@1/node_modules/semver'
  await mkdir(semver, { recursive: true })
  await writeFile(path.join(semver, 'package.json'), '{"type":"commonjs","main":"index.js"}')
  await writeFile(path.join(semver, 'index.js'), 'module.exports = { satisfies: () => true }')
}
if (args[0] === 'pg:start') { process.stdout.write('server started\\n'); process.exit(0) }
if (args[0] === 'pg:stop') process.exit(0)
if (args[0] === 'exec' && args[1] === 'node' && args[3] === 'configure') {
  const check = path.join(process.cwd(), 'configure-check')
  for (const file of ['config/masquerade.ts', 'app/services/masquerade_user_provider.ts', 'providers/masquerade_native_provider.ts', 'app/middleware/masquerade_context_middleware.ts', 'database/migrations/fixture_create_masquerade_tables.ts']) {
    const target = path.join(check, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file === 'config/masquerade.ts' ? 'consumer_check report\\n' : 'export {}\\n')
  }
  process.exit(0)
}
if (args[0] === 'exec' && args.includes('--eval')) process.exit(0)
if (args[0] === 'test' && args[1] === 'functional' && process.env.CONSUMER_FIXTURE_MODE === 'late-output') {
  spawn(process.execPath, ['late-output.js'], { cwd: process.cwd(), stdio: 'inherit' })
  for (let attempt = 0; attempt < 250; attempt++) {
    if (await readFile(${JSON.stringify(ready)}, 'utf8').catch(() => '')) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  process.stdout.write('parent exiting before trailing summary\\n')
  process.exit(0)
}
if (args[0] === 'test' && args[1] === 'functional' && ['hang', 'timeout', 'silent-descendant'].includes(process.env.CONSUMER_FIXTURE_MODE || '')) {
  spawn(process.execPath, ['term-resistant.js'], { cwd: process.cwd(), stdio: 'ignore' })
  for (let attempt = 0; attempt < 250; attempt++) {
    if (await readFile(${JSON.stringify(ready)}, 'utf8').catch(() => '')) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  if (process.env.CONSUMER_FIXTURE_MODE === 'silent-descendant') process.exit(0)
  setInterval(() => {}, 1000)
}
if (args[0] === 'test' || ['test:report', 'test:credentials'].includes(args[0])) process.stdout.write('3 passed\\n')
`
  await writeFile(path.join(bin, 'pnpm'), fakePnpm, { mode: 0o755 })
  const hookPath = path.join(directory, 'process-hook.cjs')
  await writeFile(
    hookPath,
    `if (process.env.CONSUMER_TEST_FAIL_STARTUP_LOG) { const fs = require('node:fs/promises'); const write = fs.writeFile; fs.writeFile = (file, ...args) => String(file).endsWith('postgres_start.log') ? Promise.reject(new Error('startup evidence write failed')) : write(file, ...args); require('node:module').syncBuiltinESMExports() }\nconst original = process.kill.bind(process)\nlet killedGroup = null\nprocess.kill = (pid, signal) => {\n  if (pid < 0 && signal === 'SIGTERM' && process.env.CONSUMER_TEST_TERM_MARKER) require('node:fs').writeFileSync(process.env.CONSUMER_TEST_TERM_MARKER, 'yes')\n  if (pid < 0 && signal === 'SIGKILL') { killedGroup = pid; return original(pid, signal) }\n  if (process.env.CONSUMER_TEST_FAIL_REAP === '1' && pid === killedGroup && signal === 0) return true\n  return original(pid, signal)\n}\n`
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    CONSUMER_COMMANDS: commands,
    CONSUMER_FIXTURE_MODE: options.mode ?? 'normal',
    CONSUMER_TEST_READY: ready,
    CONSUMER_TEST_RELEASE: release,
    CONSUMER_TEST_TERM_MARKER: options.hook ? termSent : '',
  }
  if (options.failStartupLog) env.CONSUMER_TEST_FAIL_STARTUP_LOG = '1'
  if (options.hook || options.failStartupLog)
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --require=${hookPath}`.trim()
  if (options.hook === 'fail-reap') env.CONSUMER_TEST_FAIL_REAP = '1'
  if (options.externalPostgres) env.CONSUMER_PG_EXTERNAL = '1'
  else delete env.CONSUMER_PG_EXTERNAL
  return { directory, root, bin, commands, ready, started, release, termSent, env }
}

function launch(f: Fixture, database: 'sqlite' | 'pg'): ChildProcess {
  return spawn(
    process.execPath,
    [
      '--import=@poppinss/ts-exec',
      path.join(f.root, 'bin/test_consumer.ts'),
      '--profile=floor',
      `--database=${database}`,
      '--package=tmp/package.tgz',
    ],
    { cwd: f.root, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
}

async function outputOf(child: ChildProcess): Promise<{ text: () => string }> {
  let output = ''
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  return { text: () => output }
}

async function collectClose(
  child: ChildProcess,
  output: { text: () => string }
): Promise<{ code: number | null; signal: NodeJS.Signals | null; text: string }> {
  const [code, signal] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null]
  return { code, signal, text: output.text() }
}

async function waitForFile(file: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(file, 'utf8')
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function waitForFixtureWorker(f: Fixture, output?: { text: () => string }): Promise<string> {
  try {
    return await waitForFile(f.ready)
  } catch (error) {
    const commands = await readFile(f.commands, 'utf8').catch(() => '')
    const commandLog = await readFile(path.join(f.root, 'timeout_probe.log'), 'utf8').catch(
      () => ''
    )
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nCLI output:\n${output?.text() ?? ''}\ncommand log:\n${commands}\nrunner log:\n${commandLog}`
    )
  }
}

async function isAlive(pid: number): Promise<boolean> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
    return state !== 'Z'
  } catch {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  }
}

async function logsDirectory(f: Fixture): Promise<string> {
  const entries = await readdir(path.join(f.root, 'tmp/consumers'))
  assert.equal(entries.length, 1)
  return path.join(f.root, 'tmp/consumers', entries[0])
}

test('waits for inherited output after command exit and records the trailing consumer summary', async ({
  cleanup,
}) => {
  const f = await fixture({ mode: 'late-output' })
  cleanup(() => rm(f.directory, { recursive: true, force: true }))
  const child = launch(f, 'sqlite')
  const output = await outputOf(child)
  await waitForFixtureWorker(f, output)
  const commandsWhileTailIsBlocked = await readFile(f.commands, 'utf8')
  assert.doesNotMatch(commandsWhileTailIsBlocked, /test token-only/)
  await writeFile(f.release, 'continue')
  const result = await collectClose(child, output)
  assert.equal(result.code, 0, result.text)
  const logs = await logsDirectory(f)
  assert.match(
    await readFile(path.join(logs, 'floor_sqlite_functional.log'), 'utf8'),
    /2 passed after output barrier/
  )
  const summary = JSON.parse(await readFile(path.join(logs, 'results.json'), 'utf8'))
  assert.equal(summary.results[0].functional, 2)
}).timeout(30_000)

test('an interrupted local PostgreSQL run drops its schema and reports failed reap while stopping its owned service', async ({
  cleanup,
}) => {
  const f = await fixture({ mode: 'hang', hook: 'fail-reap' })
  cleanup(() => rm(f.directory, { recursive: true, force: true }))
  const child = launch(f, 'pg')
  const output = await outputOf(child)
  const descendantPid = Number(await waitForFixtureWorker(f, output))
  child.kill('SIGTERM')
  await waitForFile(f.termSent)
  child.kill('SIGINT')
  const result = await collectClose(child, output)
  assert.equal(result.code, 143, result.text)
  assert.match(result.text, /Interrupted by SIGTERM/)
  assert.match(result.text, /did not exit after SIGKILL/)
  const commands = await readFile(f.commands, 'utf8')
  assert.match(commands, /pg:start/)
  assert.match(commands, /drop schema if exists consumer_floor_/)
  assert.match(commands, /pg:stop/)
  assert.doesNotMatch(commands, /test token-only/)
  assert.equal(await isAlive(descendantPid), false)
}).timeout(30_000)

test('an externally provided PostgreSQL service is never stopped', async ({ cleanup }) => {
  const f = await fixture({ externalPostgres: true })
  cleanup(() => rm(f.directory, { recursive: true, force: true }))
  const child = launch(f, 'pg')
  const output = await outputOf(child)
  const result = await collectClose(child, output)
  assert.equal(result.code, 0, result.text)
  const commands = await readFile(f.commands, 'utf8')
  assert.match(commands, /create schema consumer_floor_/)
  assert.match(commands, /drop schema if exists consumer_floor_/)
  assert.doesNotMatch(commands, /pg:start|pg:stop/)
}).timeout(30_000)

test('uses a ten-minute timeout, reaps its command group, and preserves command output', async ({
  cleanup,
}) => {
  assert.equal(consumerCommandTimeoutMs, 600_000)
  const f = await fixture({ mode: 'timeout', holdWorkerReady: true })
  cleanup(() => rm(f.directory, { recursive: true, force: true }))
  const requestedTimeoutMs = 100
  const runner = new ConsumerProcessRunner(f.root, requestedTimeoutMs)
  const originalSetTimeout = globalThis.setTimeout
  let deadlineCallback: (() => void) | undefined
  let deadlineHandle: ReturnType<typeof setTimeout> | undefined
  let child: Promise<string>
  try {
    globalThis.setTimeout = ((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === requestedTimeoutMs && !deadlineCallback) {
        deadlineCallback = () => callback(...args)
        deadlineHandle = originalSetTimeout(() => {}, 0)
        return deadlineHandle
      }
      return originalSetTimeout(callback, delay, ...args)
    }) as typeof globalThis.setTimeout
    child = runner.run(
      path.join(f.root, 'examples/native-session'),
      ['test', 'functional'],
      'timeout_probe',
      f.env
    )
  } finally {
    globalThis.setTimeout = originalSetTimeout
    if (deadlineHandle) clearTimeout(deadlineHandle)
  }
  const fireDeadline = () => {
    const callback = deadlineCallback
    deadlineCallback = undefined
    callback?.()
  }
  const rejection = assert.rejects(child, (error: unknown) => {
    assert.ok(error instanceof ConsumerCommandError)
    assert.match(error.message, new RegExp(`timed out after ${requestedTimeoutMs}ms`))
    return true
  })
  try {
    assert.ok(deadlineCallback, 'runner should register its requested timeout')
    const pid = Number(await waitForFile(f.started))
    await new Promise<void>((resolve) => originalSetTimeout(resolve, requestedTimeoutMs))
    await writeFile(f.release, 'continue')
    assert.equal(Number(await waitForFixtureWorker(f)), pid)
    fireDeadline()
    await rejection
    assert.equal(await isAlive(pid), false)
    assert.match(
      await readFile(path.join(f.root, 'timeout_probe.log'), 'utf8'),
      /RUNNER ERROR:.*timed out after 100ms/s
    )
  } finally {
    await writeFile(f.release, 'continue').catch(() => {})
    fireDeadline()
    runner.interrupt('SIGTERM')
    await rejection.catch(() => {})
  }
}).timeout(20_000)

test('settles a never-closing command with partial output and releases local handles', async ({
  cleanup,
}) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'consumer-never-close-'))
  cleanup(() => rm(directory, { recursive: true, force: true }))
  const hook = path.join(directory, 'hook.cjs')
  await writeFile(
    hook,
    `
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const cp = require('node:child_process')
const { syncBuiltinESMExports } = require('node:module')
const child = new EventEmitter()
child.pid = 99999999
child.exitCode = child.signalCode = null
child.stdout = new PassThrough()
child.stderr = new PassThrough()
const localHandle = setInterval(() => {}, 1000)
child.unref = () => { clearInterval(localHandle); child.released = true }
cp.spawn = () => { queueMicrotask(() => child.stdout.write('partial startup output')); return child }
process.kill = () => true
let clock = 0
Date.now = () => (clock += 6000)
global.consumerChild = child
syncBuiltinESMExports()
`
  )
  const probe = path.join(directory, 'probe.mjs')
  await writeFile(
    probe,
    `
import { ConsumerProcessRunner } from ${JSON.stringify(processHelperPath)}
const runner = new ConsumerProcessRunner(${JSON.stringify(directory)})
const operation = runner.run('.', ['probe'], 'never_close', process.env)
runner.interrupt('SIGTERM')
try { await operation } catch (error) {
 console.log('FIRST_SIGNAL=' + runner.interruptedBy)
 console.log(JSON.stringify({message:error.message, released:global.consumerChild.released,
 stdoutDestroyed:global.consumerChild.stdout.destroyed, stderrDestroyed:global.consumerChild.stderr.destroyed}))
}
`
  )
  const child = spawn(process.execPath, ['--require', hook, '--import=@poppinss/ts-exec', probe], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = await outputOf(child)
  const result = await collectClose(child, output)
  assert.equal(result.code, 0, result.text)
  assert.match(result.text, /FIRST_SIGNAL=SIGTERM/)
  assert.match(result.text, /partial startup output/)
  assert.match(result.text, /did not exit after SIGKILL/)
  assert.match(result.text, /"released":true,"stdoutDestroyed":true,"stderrDestroyed":true/)
}).timeout(10_000)

test('successful PostgreSQL startup with a failed log write retains actual owned-service recovery', async ({
  cleanup,
}) => {
  const f = await fixture({ failStartupLog: true })
  cleanup(() => rm(f.directory, { recursive: true, force: true }))
  const child = launch(f, 'pg')
  const output = await outputOf(child)
  const result = await collectClose(child, output)
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, /startup evidence write failed/)
  assert.match(result.text, /server started/)
  const commands = await readFile(f.commands, 'utf8')
  assert.match(commands, /pg:start[\s\S]*pg:stop/)
  assert.doesNotMatch(commands, /create schema/)
}).timeout(30_000)

for (const exitCode of [0, 7]) {
  test(`rejoins interruption and cleanup failure across a pending log write after exit ${exitCode}`, async ({
    cleanup,
  }) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'consumer-write-race-'))
    cleanup(() => rm(directory, { recursive: true, force: true }))
    const hook = path.join(directory, 'hook.cjs')
    await writeFile(
      hook,
      `
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const cp = require('node:child_process')
const fs = require('node:fs/promises')
const child = new EventEmitter()
child.pid = 99999999
child.exitCode = child.signalCode = null
child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.unref = () => {}
cp.spawn = () => { queueMicrotask(() => { child.stdout.write('operation output'); child.emit('close', ${exitCode}, null) }); return child }
process.kill = (pid, signal) => { if (signal === 'SIGTERM') throw new Error('TERM rejected'); const error = new Error('gone'); error.code='ESRCH'; throw error }
fs.writeFile = async () => { await global.writeBarrier(); throw new Error('log write rejected') }
require('node:module').syncBuiltinESMExports()
`
    )
    const probe = path.join(directory, 'probe.mjs')
    await writeFile(
      probe,
      `
import { ConsumerProcessRunner } from ${JSON.stringify(processHelperPath)}
const runner = new ConsumerProcessRunner(${JSON.stringify(directory)})
let release, entered
const barrier = new Promise(resolve => release = resolve)
const writing = new Promise(resolve => entered = resolve)
global.writeBarrier = async () => { entered(); await barrier }
const operation = runner.run('.', ['probe'], 'failed_operation', process.env)
await writing
runner.interrupt('SIGTERM'); runner.interrupt('SIGINT'); release()
try { await operation } catch (error) {
 console.log(error.message)
 console.log('FIRST_SIGNAL=' + runner.interruptedBy)
 console.log('PRIMARY=' + error.primaryError.message)
 console.log('CAUSES=' + error.cleanupErrors.length)
}
`
    )
    const child = spawn(
      process.execPath,
      ['--require', hook, '--import=@poppinss/ts-exec', probe],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    const output = await outputOf(child)
    const result = await collectClose(child, output)
    assert.equal(result.code, 0, result.text)
    assert.match(result.text, /TERM rejected/)
    assert.match(result.text, /log write rejected/)
    assert.match(result.text, /operation output/)
    assert.match(
      result.text,
      exitCode === 0 ? /PRIMARY=Interrupted by SIGTERM/ : /PRIMARY=exited with code 7/
    )
    assert.match(result.text, /FIRST_SIGNAL=SIGTERM/)
    assert.match(result.text, exitCode === 0 ? /CAUSES=2/ : /CAUSES=3/)
  }).timeout(10_000)
}

test('normal close cleans a silent owned descendant before allowing later work', async ({
  cleanup,
}) => {
  const f = await fixture({ mode: 'silent-descendant' })
  cleanup(() => rm(f.directory, { recursive: true, force: true }))
  const runner = new ConsumerProcessRunner(f.root)
  let laterWork = false
  const operation = runner
    .run(path.join(f.root, 'examples/native-session'), ['test', 'functional'], 'silent', f.env)
    .then(
      () => {
        laterWork = true
      },
      (error) => {
        assert.ok(error instanceof ConsumerCommandError)
        assert.match(error.message, /did not exit after SIGKILL/)
      }
    )
  const pid = Number(await waitForFixtureWorker(f))
  assert.equal(laterWork, false)
  await operation
  assert.equal(await isAlive(pid), false)
}).timeout(20_000)
