import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { connect, createServer } from 'node:net'
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node24 = process.execPath
const tsExec = path.join(repoRoot, 'node_modules/@poppinss/ts-exec/build/index.js')
const launcherSource = path.join(repoRoot, 'bin/demo_account_kit.ts')
const helperSource = path.join(repoRoot, 'bin/helpers')
const nativeSource = path.join(repoRoot, 'examples/native-session')
const overlaySource = path.join(repoRoot, 'examples/account-kit-demo')
const wiringSource = path.join(helperSource, 'account_kit_host_wiring.ts')
const kitUrl =
  'https://github.com/Kevinjohn/oss-adonisjs-account-kit/releases/download/v0.1.3/adonisjs-account-kit-0.1.3.tgz'
const kitSha = '1ca53538256c360cb87ddbadfaf00f2364a453fea349f6bb8757e58756ed9e7f'
const syntheticKit = Buffer.from('synthetic Account Kit release for isolated launcher tests\n')
const syntheticSha = createHash('sha256').update(syntheticKit).digest('hex')
const stopTimeoutMs = 8_000

let sharedFixtureRoot
let fixtureNode
let fixturePreload

async function setupSharedRuntime() {
  sharedFixtureRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'account-kit-demo-tests-'))
  )
  const fakebin = path.join(sharedFixtureRoot, 'fakebin')
  await mkdir(fakebin)
  fixtureNode = path.join(fakebin, 'node')
  try {
    await copyFile(node24, fixtureNode, constants.COPYFILE_FICLONE)
  } catch (error) {
    if (!['EPERM', 'EXDEV', 'EINVAL'].includes(error.code)) throw error
    await copyFile(node24, fixtureNode)
  }
  await chmod(fixtureNode, 0o755)
  await writeFile(path.join(fakebin, 'pnpm'), fakePnpm, { mode: 0o755 })
  fixturePreload = path.join(sharedFixtureRoot, 'fetch-preload.mjs')
  await writeFile(fixturePreload, fetchPreload)
}

const fakePnpm = `#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const args = process.argv.slice(2)
const command = args.join(' ')
const logPath = process.env.KIT_DEMO_TEST_LOG
const record = async (item) => writeFile(logPath, (await readFile(logPath, 'utf8').catch(() => '')) + JSON.stringify(item) + '\\n')
await record({ kind: 'pnpm', pid: process.pid, pgid: process.pid, args, command, cwd: process.cwd(), node: process.version, execPath: process.execPath, env: { NODE_ENV: process.env.NODE_ENV, DB_CLIENT: process.env.DB_CLIENT, SESSION_DRIVER: process.env.SESSION_DRIVER, HOST: process.env.HOST, PORT: process.env.PORT, APP_URL: process.env.APP_URL } })
if (process.env.KIT_DEMO_TEST_DELAY_AT && command.includes(process.env.KIT_DEMO_TEST_DELAY_AT)) {
  await writeFile(process.env.KIT_DEMO_TEST_CHILD_PID, String(process.pid))
  await new Promise(() => setInterval(() => {}, 1000))
}
if (process.env.KIT_DEMO_TEST_FAIL_AT && command.includes(process.env.KIT_DEMO_TEST_FAIL_AT)) {
  await writeFile(process.env.KIT_DEMO_TEST_CHILD_PID, String(process.pid))
  if (process.env.KIT_DEMO_TEST_ORPHAN === '1') {
    const orphan = spawn(process.execPath, [process.env.KIT_DEMO_TEST_ORPHAN_SCRIPT], { cwd: process.cwd(), env: process.env, stdio: 'ignore' })
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await readFile(process.env.KIT_DEMO_TEST_ORPHAN_PID, 'utf8').catch(() => '')) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await record({ kind: 'orphan-started', pid: orphan.pid })
  }
  if (process.env.KIT_DEMO_TEST_HOLD_FAILURE === '1') {
    while (!(await readFile(process.env.KIT_DEMO_TEST_RELEASE_FAILURE, 'utf8').catch(() => ''))) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  process.exit(17)
}
if (args[0] === 'pack') {
  const output = args[args.indexOf('--out') + 1]
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, 'masquerade test tarball')
}
if (args[0] === 'install') {
  await mkdir('node_modules', { recursive: true })
  await writeFile('pnpm-lock.yaml', await readFile('pnpm-lock.yaml', 'utf8').catch(() => 'lockfileVersion: 9\\n'))
}
`

const fetchPreload = `import { readFile, appendFile } from 'node:fs/promises'
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === process.env.KIT_DEMO_TEST_RELEASE_URL) {
    await appendFile(process.env.KIT_DEMO_TEST_FETCH_LOG, url + '\\n')
    return new Response(await readFile(process.env.KIT_DEMO_TEST_RELEASE_BYTES), { status: 200 })
  }
  if (url.startsWith('http://127.0.0.1:')) {
    const response = await realFetch(input, init)
    const originalText = response.text.bind(response)
    response.text = async () => {
      const body = await originalText()
      await appendFile(process.env.KIT_DEMO_TEST_READINESS_BODY_LOG, JSON.stringify({ status: response.status, body }) + '\\n')
      return body
    }
    return response
  }
  throw new Error('Unexpected outbound request blocked by the test preload: ' + url)
}
`

const fakeAce = `import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const command = process.argv[2]
const args = process.argv.slice(3)
const logPath = process.env.KIT_DEMO_TEST_LOG
const log = async (item) => writeFile(logPath, (await readFile(logPath, 'utf8').catch(() => '')) + JSON.stringify({ kind: 'ace', pid: process.pid, pgid: process.pid, command, args, cwd: process.cwd(), node: process.version, execPath: process.execPath, env: { NODE_ENV: process.env.NODE_ENV, DB_CLIENT: process.env.DB_CLIENT, SESSION_DRIVER: process.env.SESSION_DRIVER, HOST: process.env.HOST, PORT: process.env.PORT, APP_URL: process.env.APP_URL } }) + '\\n')
await log()
if (process.env.KIT_DEMO_TEST_DELAY_AT && process.env.KIT_DEMO_TEST_DELAY_AT.includes(command)) await new Promise(() => setInterval(() => {}, 1000))
if (process.env.KIT_DEMO_TEST_FAIL_AT && process.env.KIT_DEMO_TEST_FAIL_AT.includes(command)) process.exit(17)
if (command === 'generate:key') {
  const env = await readFile('.env', 'utf8')
  await writeFile('.env', env.replace('replace_me_with_node_ace_generate_key', 'base64:demo-test-key'))
}
if (command === 'configure') {
  await mkdir('database/migrations', { recursive: true })
  try { await readFile('database/migrations/1780000000000_account_kit_users.ts') } catch { await writeFile('database/migrations/1780000000000_account_kit_users.ts', 'export default class AccountKitUsers {}\\n') }
}
if (command === 'account-kit:admission:install') {
  await mkdir('database/migrations', { recursive: true })
  try { await readFile('database/migrations/1780000000001_account_kit_admission.ts') } catch { await writeFile('database/migrations/1780000000001_account_kit_admission.ts', 'export default class AccountKitAdmission {}\\n') }
}
if (command === 'migration:run') {
  await mkdir('tmp', { recursive: true })
  try { await readFile('tmp/db.sqlite3') } catch { await writeFile('tmp/db.sqlite3', '{"users":[]}') }
}
if (command === 'codegen') {
  await mkdir('database', { recursive: true })
  await writeFile('database/schema.ts', 'export default {}\\n')
}
if (command === 'demo:kit-seed') {
  const usersPath = 'users.json'
  const current = JSON.parse(await readFile(usersPath, 'utf8').catch(() => '{"fullName":"Demo Operator"}'))
  await writeFile(usersPath, JSON.stringify(current))
}
if (command === 'serve') {
  if (process.env.KIT_DEMO_TEST_SERVER_FAIL === '1') process.exit(23)
  if (process.env.KIT_DEMO_TEST_UNRELATED_SERVER === '1') {
    await writeFile(process.env.KIT_DEMO_TEST_OWNED_SERVER_READY, 'ready')
    while (!(await readFile(process.env.KIT_DEMO_TEST_EXIT_SERVER, 'utf8').catch(() => ''))) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    process.exit(23)
  }
  const port = Number(process.env.PORT)
  const responseBody = process.env.KIT_DEMO_TEST_BAD_PAGE === '1' ? '<main>Different application</main>' : '<main data-demo="account-kit">Login</main>'
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(responseBody) })
  await new Promise((resolve, reject) => setTimeout(() => server.listen(port, '127.0.0.1', resolve).once('error', reject), Number(process.env.KIT_DEMO_TEST_SERVER_DELAY ?? 0)))
  await writeFile('server.pid', String(process.pid))
}
`

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) =>
    server.listen(0, '127.0.0.1', resolve).once('error', reject)
  )
  const { port } = server.address()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

async function fixture(options = {}) {
  const id = Math.random().toString(36).slice(2)
  const root = path.join(sharedFixtureRoot, `checkout-${id}`)
  await mkdir(path.join(root, 'bin'), { recursive: true })
  await mkdir(path.join(root, 'examples'), { recursive: true })
  await cp(launcherSource, path.join(root, 'bin/demo_account_kit.ts'))
  await cp(helperSource, path.join(root, 'bin/helpers'), { recursive: true })
  await cp(nativeSource, path.join(root, 'examples/native-session'), { recursive: true })
  await cp(overlaySource, path.join(root, 'examples/account-kit-demo'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n')
  await writeFile(
    path.join(root, 'tsconfig.json'),
    '{"compilerOptions":{"rewriteRelativeImportExtensions":true}}\n'
  )
  await writeFile(path.join(root, 'examples/native-session/ace.js'), fakeAce)
  const copiedWiring = path.join(root, 'bin/helpers/account_kit_host_wiring.ts')
  const pinnedSource = await readFile(wiringSource, 'utf8')
  assert.equal((pinnedSource.match(new RegExp(kitSha, 'g')) ?? []).length, 1)
  assert.match(
    pinnedSource,
    /kitReleaseUrl\s*=\s*'https:\/\/github\.com\/Kevinjohn\/oss-adonisjs-account-kit\/releases\/download\/v0\.1\.3\/adonisjs-account-kit-0\.1\.3\.tgz'/
  )
  assert.match(pinnedSource, new RegExp(`kitReleaseVersion\\s*=\\s*'0\\.1\\.3'`))
  assert.match(pinnedSource, new RegExp(`kitReleaseSha256\\s*=\\s*'${kitSha}'`))
  if (options.patchPin !== false) {
    const copiedText = await readFile(copiedWiring, 'utf8')
    assert.equal((copiedText.match(new RegExp(kitSha, 'g')) ?? []).length, 1)
    await writeFile(copiedWiring, copiedText.replace(kitSha, syntheticSha))
  }
  await writeFile(
    path.join(root, 'orphan.mjs'),
    `import { writeFile } from 'node:fs/promises'; await writeFile(process.env.KIT_DEMO_TEST_ORPHAN_PID, String(process.pid)); await new Promise(() => setInterval(() => {}, 1000))\n`
  )
  const port = options.port ?? (await freePort())
  const stateRoot = path.join(root, 'tmp/account-kit-demo')
  const fetchLog = path.join(root, 'fetch.log')
  const releaseBytes = path.join(root, 'synthetic-account-kit.tgz')
  await writeFile(releaseBytes, syntheticKit)
  const env = { ...process.env }
  for (const name of [
    'NODE_ENV',
    'PORT',
    'APP_URL',
    'HOST',
    'APP_KEY',
    'DB_CLIENT',
    'SESSION_DRIVER',
  ])
    delete env[name]
  for (const name of Object.keys(env)) {
    if (name.startsWith('ACCOUNT_KIT_') || name.startsWith('MASQUERADE_')) delete env[name]
  }
  Object.assign(
    env,
    {
      PATH: `${path.dirname(fixtureNode)}:${process.env.PATH}`,
      PORT: String(port),
      KIT_DEMO_TEST_LOG: path.join(root, 'commands.jsonl'),
      KIT_DEMO_TEST_FETCH_LOG: fetchLog,
      KIT_DEMO_TEST_READINESS_BODY_LOG: path.join(root, 'readiness-bodies.jsonl'),
      KIT_DEMO_TEST_RELEASE_BYTES: releaseBytes,
      KIT_DEMO_TEST_RELEASE_URL: kitUrl,
      KIT_DEMO_TEST_ORPHAN_PID: path.join(root, 'orphan.pid'),
      KIT_DEMO_TEST_ORPHAN_SCRIPT: path.join(root, 'orphan.mjs'),
      KIT_DEMO_TEST_CHILD_PID: path.join(root, 'child.pid'),
      KIT_DEMO_TEST_OWNED_SERVER_READY: path.join(root, 'owned-server-ready'),
      KIT_DEMO_TEST_EXIT_SERVER: path.join(root, 'exit-owned-server'),
      KIT_DEMO_TEST_RELEASE_FAILURE: path.join(root, 'release-failure'),
    },
    options.env ?? {}
  )
  if (options.failAt) env.KIT_DEMO_TEST_FAIL_AT = options.failAt
  if (options.delayAt) env.KIT_DEMO_TEST_DELAY_AT = options.delayAt
  if (options.orphan) env.KIT_DEMO_TEST_ORPHAN = '1'
  if (options.badPage) env.KIT_DEMO_TEST_BAD_PAGE = '1'
  if (options.serverFail) env.KIT_DEMO_TEST_SERVER_FAIL = '1'
  if (options.unrelatedServer) env.KIT_DEMO_TEST_UNRELATED_SERVER = '1'
  if (options.holdFailure) env.KIT_DEMO_TEST_HOLD_FAILURE = '1'
  if (options.serverDelay) env.KIT_DEMO_TEST_SERVER_DELAY = String(options.serverDelay)
  return {
    root,
    stateRoot,
    app: path.join(stateRoot, 'app'),
    port,
    env,
    fetchLog,
    releaseBytes,
    processGroups: new Set(),
    runs: new Set(),
  }
}

function tracked(child, demo, text = () => '', t) {
  let exitResult
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      exitResult = { code, signal }
      resolve(exitResult)
    })
  })
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve(exitResult ?? { code, signal }))
  })
  void exited.catch(() => {})
  void closed.catch(() => {})
  const run = {
    child,
    demo,
    exited,
    closed,
    text,
    timedOut: false,
    cleanupPromise: undefined,
    watchdog: undefined,
  }
  if (demo && child.pid && process.platform !== 'win32') demo.processGroups.add(child.pid)
  demo?.runs.add(run)
  run.watchdog = setTimeout(() => {
    run.timedOut = true
    void killRun(run).catch(() => {})
  }, stopTimeoutMs)
  run.watchdog.unref()
  void closed.then(
    () => clearTimeout(run.watchdog),
    () => clearTimeout(run.watchdog)
  )
  t?.after(() => killRun(run))
  return run
}

function launch(demo, args = [], t) {
  const child = spawn(
    fixtureNode,
    [
      '--import',
      tsExec,
      '--import',
      fixturePreload,
      path.join(demo.root, 'bin/demo_account_kit.ts'),
      ...args,
    ],
    {
      cwd: demo.root,
      env: demo.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    }
  )
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
  })
  const run = tracked(child, demo, () => output, t)
  return run
}

async function exitOf(run, timeoutMs = stopTimeoutMs) {
  let timer
  try {
    return await Promise.race([
      run.closed.then(({ code, signal }) => ({ code, signal, text: run.text() })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Launcher timed out: ${run.text()}`)), timeoutMs)
      }),
    ]).then((result) => {
      if (run.timedOut)
        throw new Error(`Spawned process exceeded its ${stopTimeoutMs}ms watchdog: ${run.text()}`)
      return result
    })
  } catch (error) {
    await killRun(run)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function killRun(run, signal = 'SIGTERM') {
  if (run.cleanupPromise) return run.cleanupPromise
  run.cleanupPromise = (async () => {
    clearTimeout(run.watchdog)
    if (run.child.pid && run.child.exitCode === null && run.child.signalCode === null) {
      try {
        if (process.platform !== 'win32') process.kill(-run.child.pid, signal)
        else run.child.kill(signal)
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    await Promise.race([
      run.exited.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ])
    if (run.demo) await cleanupFixtureChildren(run.demo)
    else if (run.child.pid && run.child.exitCode === null && run.child.signalCode === null) {
      try {
        run.child.kill('SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    await bounded(
      run.exited.catch(() => {}),
      1500,
      'launcher exit'
    )
    await bounded(
      run.closed.catch(() => {}),
      1500,
      'launcher stdio close'
    )
  })()
  return run.cleanupPromise
}

async function bounded(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function cleanupFixtureChildren(demo) {
  const calls = await commandLog(demo).catch(() => [])
  const pids = new Set([
    ...demo.processGroups,
    ...calls
      .filter((call) => ['pnpm', 'ace'].includes(call.kind))
      .map((call) => Number(call.pgid))
      .filter((pid) => Number.isInteger(pid) && pid > 1),
  ])
  const target = (pid) => (process.platform === 'win32' ? pid : -pid)
  const exists = (pid) => {
    try {
      process.kill(target(pid), 0)
      return true
    } catch (error) {
      if (error.code === 'ESRCH') return false
      if (error.code === 'EPERM') return true
      throw error
    }
  }
  const signal = (pid, name) => {
    try {
      process.kill(target(pid), name)
    } catch (error) {
      if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error
    }
  }
  for (const pid of pids) signal(pid, 'SIGTERM')
  const gracefulDeadline = Date.now() + 1500
  while ([...pids].some(exists) && Date.now() < gracefulDeadline)
    await new Promise((resolve) => setTimeout(resolve, 25))
  for (const pid of pids) if (exists(pid)) signal(pid, 'SIGKILL')
  const forcedDeadline = Date.now() + 1500
  while ([...pids].some(exists) && Date.now() < forcedDeadline)
    await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(
    [...pids].filter(exists),
    [],
    `fixture-owned process groups still running: ${[...pids].filter(exists).join(', ')}`
  )
  const orphanPid = Number(
    await readFile(path.join(demo.root, 'orphan.pid'), 'utf8').catch(() => '')
  )
  if (Number.isInteger(orphanPid) && orphanPid > 1) {
    try {
      process.kill(orphanPid, 0)
      assert.fail(`fixture descendant ${orphanPid} survived group cleanup`)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}

async function cleanupFixture(demo) {
  for (const run of demo.runs) await killRun(run)
  // Read the registry once more after all launchers have stopped: a child can log during shutdown.
  await cleanupFixtureChildren(demo)
  await rm(demo.root, { recursive: true, force: true })
}

async function waitForFile(file, timeoutMs = 6000, run) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(file, 'utf8')
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const log = run
    ? await readFile(path.join(demoRootFromApp(file), 'commands.jsonl'), 'utf8').catch(() => '')
    : ''
  throw new Error(`Timed out waiting for ${file}${run ? `\n${run.text()}\n${log}` : ''}`)
}

async function waitForHttp(demo, run) {
  const deadline = Date.now() + 3000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${demo.port}/login`, {
        signal: AbortSignal.timeout(750),
      })
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  const log = await readFile(path.join(demo.root, 'commands.jsonl'), 'utf8').catch(() => '')
  throw new Error(
    `Server did not answer after readiness marker: ${lastError}\n${run.text()}\n${log}`
  )
}

async function waitForText(run, expected, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (run.text().includes(expected)) return
    if (run.child.exitCode !== null || run.child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Expected output ${expected}\n${run.text()}`)
}

function assertAlive(pid) {
  assert.doesNotThrow(() => process.kill(pid, 0), `expected process ${pid} to be alive`)
}

function assertAliveGroup(pgid) {
  assert.doesNotThrow(() => process.kill(-pgid, 0), `expected process group ${pgid} to be alive`)
}

function demoRootFromApp(file) {
  return path.resolve(path.dirname(file), '../../..')
}

async function waitForLog(demo, matcher, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await readFile(path.join(demo.root, 'commands.jsonl'), 'utf8').catch(() => '')
    if (matcher.test(text)) return text
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for command log ${matcher}`)
}

async function commandLog(demo) {
  return (await readFile(path.join(demo.root, 'commands.jsonl'), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function waitForReadinessBodies(demo, count, run) {
  const file = path.join(demo.root, 'readiness-bodies.jsonl')
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const rows = (await readFile(file, 'utf8').catch(() => '')).split('\n').slice(0, -1)
    if (rows.length >= count) return rows.map((row) => JSON.parse(row))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Expected ${count} completed readiness bodies: ${run.text()}`)
}

async function listening(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error) => resolve(error.code === 'EADDRINUSE'))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () =>
      server.close(() => resolve(false))
    )
  })
}

async function waitForListening(port, expected, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await listening(port)) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(await listening(port), expected, `port ${port} did not reach listening=${expected}`)
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function startUnrelatedListener(port, holdHeaders) {
  const requestSeen = deferred()
  const headersSent = deferred()
  const responseClosed = deferred()
  const releaseHeaders = deferred()
  const releaseBody = deferred()
  const server = createHttpServer(async (_request, response) => {
    response.once('close', responseClosed.resolve)
    requestSeen.resolve()
    if (holdHeaders) await releaseHeaders.promise
    if (response.destroyed) return
    response.writeHead(200, { 'content-type': 'text/html' })
    response.flushHeaders()
    headersSent.resolve()
    await releaseBody.promise
    if (!response.destroyed) response.end('<main>Unrelated listener</main>')
  })
  await new Promise((resolve, reject) =>
    server.listen(port, '127.0.0.1', resolve).once('error', reject)
  )
  let closePromise
  const close = () =>
    (closePromise ??= (async () => {
      releaseHeaders.resolve()
      releaseBody.resolve()
      server.closeAllConnections()
      await bounded(
        new Promise((resolve) => server.close(resolve)),
        1500,
        'unrelated listener close'
      )
    })())
  return { server, requestSeen, headersSent, responseClosed, close }
}

async function assertAcceptsConnection(port) {
  const socket = connect(port, '127.0.0.1')
  try {
    await bounded(once(socket, 'connect'), 1000, 'unrelated listener connection')
  } finally {
    socket.destroy()
  }
}

async function stopReady(run, expected = 130) {
  run.child.kill('SIGINT')
  const result = await exitOf(run)
  assert.equal(result.code, expected, result.text)
  return result
}

async function bootstrapMarker(demo, schema = 1) {
  await mkdir(path.join(demo.app, 'tmp'), { recursive: true })
  await writeFile(path.join(demo.stateRoot, 'recipe.json'), JSON.stringify({ schema }))
}

test.before(async () => setupSharedRuntime())
test.after(async () => rm(sharedFixtureRoot, { recursive: true, force: true }))

test('asserts Node 24 and rejects other or unparseable versions', async (t) => {
  const demo = await fixture()
  t.after(() => cleanupFixture(demo))
  const source = path.join(demo.root, 'bin/demo_account_kit.ts')
  const evalSource = `import { assertNodeVersion } from ${JSON.stringify(source)}; assertNodeVersion('24.0.0'); assert.throws(() => assertNodeVersion('23.11.0'), /requires Node.js 24/); assert.throws(() => assertNodeVersion('unknown'), /requires Node.js 24/)`
  const child = spawn(
    fixtureNode,
    [
      '--import',
      tsExec,
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict'; ${evalSource}`,
    ],
    { cwd: demo.root, env: demo.env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
  })
  const run = tracked(child, undefined, () => output, t)
  const result = await exitOf(run)
  assert.equal(result.code, 0, result.text)
})

test('bootstraps from a clean workspace, downloads only the pinned release URL, and persists app state on relaunch', async (t) => {
  const demo = await fixture()
  t.after(() => cleanupFixture(demo))
  for (let iteration = 0; iteration < 2; iteration++) {
    const run = launch(demo, [], t)
    await waitForText(run, 'Account Kit demo ready:')
    await waitForText(run, 'operator@example.test / demo-operator-2026')
    assert.match(run.text(), /operator@example\.test \/ demo-operator-2026/)
    await waitForFile(path.join(demo.app, 'server.pid'), 6000, run)
    const response = await waitForHttp(demo, run)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /data-demo="account-kit"/)
    const envPath = path.join(demo.app, '.env')
    const envText = await readFile(envPath, 'utf8')
    assert.match(envText, /APP_KEY=base64:demo-test-key/)
    if (iteration === 0) {
      demo.firstEnv = envText
      await writeFile(
        path.join(demo.app, 'tmp/db.sqlite3'),
        JSON.stringify({ users: [{ full_name: 'Edited Operator' }] })
      )
      await writeFile(path.join(demo.app, 'tmp/db.sqlite3-wal'), 'wal-state')
      await writeFile(path.join(demo.app, 'tmp/keep.txt'), 'not a sqlite file')
      await writeFile(
        path.join(demo.app, 'users.json'),
        JSON.stringify({ fullName: 'Edited Operator' })
      )
    } else {
      assert.equal(envText, demo.firstEnv)
      assert.deepEqual(JSON.parse(await readFile(path.join(demo.app, 'tmp/db.sqlite3'), 'utf8')), {
        users: [{ full_name: 'Edited Operator' }],
      })
      assert.equal(await readFile(path.join(demo.app, 'tmp/db.sqlite3-wal'), 'utf8'), 'wal-state')
      assert.equal(
        await readFile(path.join(demo.app, 'users.json'), 'utf8'),
        JSON.stringify({ fullName: 'Edited Operator' })
      )
    }
    const migrations = await readdir(path.join(demo.app, 'database/migrations'))
    const kitMigrations = migrations.filter((name) => name.includes('account_kit_')).sort()
    if (iteration === 0) {
      demo.migrationNames = kitMigrations
      const firstMigration = path.join(demo.app, 'database/migrations', kitMigrations[0])
      await writeFile(firstMigration, 'operator-edited generated migration\n')
      demo.migrationBytes = await Promise.all(
        kitMigrations.map((name) =>
          readFile(path.join(demo.app, 'database/migrations', name), 'utf8')
        )
      )
    } else {
      assert.deepEqual(kitMigrations, demo.migrationNames)
      assert.deepEqual(
        await Promise.all(
          kitMigrations.map((name) =>
            readFile(path.join(demo.app, 'database/migrations', name), 'utf8')
          )
        ),
        demo.migrationBytes
      )
    }
    const calls = await commandLog(demo)
    assert.equal(
      calls.every(
        (call) =>
          Number(call.node.split('.')[0].slice(1)) === 24 &&
          path.resolve(call.execPath) === fixtureNode
      ),
      true
    )
    assert.equal(
      calls.every(
        (call) =>
          call.env.NODE_ENV === 'development' &&
          call.env.DB_CLIENT === 'sqlite' &&
          call.env.SESSION_DRIVER === 'database'
      ),
      true
    )
    const fetches = (await readFile(demo.fetchLog, 'utf8')).trim().split('\n')
    assert.deepEqual(fetches, [kitUrl])
    await stopReady(run)
    assert.equal(await listening(demo.port), false)
  }
  const original = await readFile(wiringSource, 'utf8')
  assert.match(original, new RegExp(kitSha))
  assert.equal(
    await readFile(path.join(demo.stateRoot, 'recipe.json'), 'utf8').then(
      (text) => JSON.parse(text).schema
    ),
    1
  )
  await writeFile(path.join(demo.stateRoot, 'account-kit-0.1.3.tgz'), 'tampered on relaunch')
  const callsBeforeTamper = (await commandLog(demo)).length
  const tamperedRelaunch = launch(demo, [], t)
  const tamperedResult = await exitOf(tamperedRelaunch)
  assert.equal(tamperedResult.code, 1, tamperedResult.text)
  assert.match(tamperedResult.text, /Cached Account Kit release has a SHA-256 mismatch/)
  assert.deepEqual((await readFile(demo.fetchLog, 'utf8')).trim().split('\n'), [kitUrl])
  assert.equal(
    (await commandLog(demo))
      .slice(callsBeforeTamper)
      .some((call) => call.kind === 'ace' || call.command.startsWith('install')),
    false
  )
})

test('rejects an unmarked workspace and a marker from another schema without deleting contents', async (t) => {
  for (const [label, setup] of [
    [
      'foreign workspace',
      async (demo) => {
        await mkdir(demo.stateRoot, { recursive: true })
        await writeFile(path.join(demo.stateRoot, 'keep.txt'), 'foreign')
      },
    ],
    [
      'schema mismatch',
      async (demo) => {
        await bootstrapMarker(demo, 999)
        await writeFile(path.join(demo.stateRoot, 'keep.txt'), 'versioned')
      },
    ],
  ]) {
    const demo = await fixture()
    t.after(() => cleanupFixture(demo))
    await setup(demo)
    const run = launch(demo, [], t)
    const result = await exitOf(run)
    assert.equal(result.code, 1, `${label}: ${result.text}`)
    assert.match(result.text, /Unrecognized demo workspace/)
    assert.equal(
      await readFile(path.join(demo.stateRoot, 'keep.txt'), 'utf8'),
      label === 'foreign workspace' ? 'foreign' : 'versioned'
    )
    assert.deepEqual(await commandLog(demo), [])
  }
})

test('refuses each incompatible environment value from .env and the process before setup', async (t) => {
  const invalid = [
    ['NODE_ENV', 'production'],
    ['DB_CLIENT', 'pg'],
    ['SESSION_DRIVER', 'cookie'],
    ['APP_URL', 'https://example.test'],
    ['ACCOUNT_KIT_SESSION_STRATEGY', 'token'],
    ['MASQUERADE_CONTROL_STORE', 'remote'],
  ]
  for (const source of ['file', 'process']) {
    for (const [key, value] of invalid) {
      const demo = await fixture()
      t.after(() => cleanupFixture(demo))
      await bootstrapMarker(demo)
      if (source === 'file')
        await writeFile(
          path.join(demo.app, '.env'),
          `NODE_ENV=development\nPORT=${demo.port}\nAPP_URL=http://127.0.0.1:${demo.port}\n${key}=${value}\n`
        )
      else demo.env[key] = value
      const run = launch(demo, [], t)
      const result = await exitOf(run)
      assert.equal(result.code, 1, `${source} ${key}: ${result.text}`)
      assert.match(
        result.text,
        new RegExp(
          key === 'ACCOUNT_KIT_SESSION_STRATEGY'
            ? 'ACCOUNT_KIT_'
            : key === 'MASQUERADE_CONTROL_STORE'
              ? 'MASQUERADE_'
              : key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        )
      )
      assert.deepEqual(await commandLog(demo), [])
    }
  }
})

test('refuses IPv4, wildcard, and IPv6 port owners without stopping them or changing the workspace', async (t) => {
  const owners = ['127.0.0.1', '0.0.0.0', '::', '::1']
  for (const host of owners) {
    const port = await freePort()
    const owner = createServer()
    try {
      owner.listen(port, host)
      await once(owner, 'listening')
    } catch (error) {
      if (
        (host === '::' || host === '::1') &&
        ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)
      )
        continue
      throw error
    }
    t.after(() => new Promise((resolve) => owner.close(resolve)))
    const demo = await fixture({ port })
    t.after(() => cleanupFixture(demo))
    await bootstrapMarker(demo)
    await writeFile(path.join(demo.app, 'tmp/db.sqlite3'), 'keep')
    const run = launch(demo, [], t)
    const result = await exitOf(run)
    assert.equal(result.code, 1, result.text)
    assert.match(result.text, new RegExp(`Port ${port} is already in use`))
    assert.equal(owner.listening, true)
    assert.equal(await readFile(path.join(demo.app, 'tmp/db.sqlite3'), 'utf8'), 'keep')
    assert.deepEqual(await commandLog(demo), [])
  }
})

test('rejects tampered cached artifacts and synthetic bytes against the production checksum', async (t) => {
  const tampered = await fixture()
  t.after(() => cleanupFixture(tampered))
  await mkdir(tampered.stateRoot, { recursive: true })
  await writeFile(path.join(tampered.stateRoot, 'recipe.json'), JSON.stringify({ schema: 1 }))
  await writeFile(path.join(tampered.stateRoot, 'account-kit-0.1.3.tgz'), 'tampered cache')
  const first = launch(tampered, [], t)
  const firstResult = await exitOf(first)
  assert.equal(firstResult.code, 1, firstResult.text)
  assert.match(firstResult.text, /SHA-256 mismatch/)
  assert.equal(
    (await commandLog(tampered)).some(
      (call) => call.kind === 'ace' || call.command.startsWith('install')
    ),
    false
  )

  const unmodified = await fixture({ patchPin: false })
  t.after(() => cleanupFixture(unmodified))
  await mkdir(unmodified.stateRoot, { recursive: true })
  await writeFile(path.join(unmodified.stateRoot, 'recipe.json'), JSON.stringify({ schema: 1 }))
  await copyFile(unmodified.releaseBytes, path.join(unmodified.stateRoot, 'account-kit-0.1.3.tgz'))
  const second = launch(unmodified, [], t)
  const secondResult = await exitOf(second)
  assert.equal(secondResult.code, 1, secondResult.text)
  assert.match(secondResult.text, /SHA-256 mismatch/)
  assert.equal(
    (await commandLog(unmodified)).some(
      (call) => call.kind === 'ace' || call.command.startsWith('install')
    ),
    false
  )
})

test('reports setup failure, cleans the process group, then refuses the incomplete workspace on relaunch', async (t) => {
  const demo = await fixture({ failAt: 'install', orphan: true, holdFailure: true })
  t.after(() => cleanupFixture(demo))
  const run = launch(demo, [], t)
  const orphanPid = Number(await waitForFile(path.join(demo.root, 'orphan.pid'), 6000, run))
  const installPid = Number(await waitForFile(path.join(demo.root, 'child.pid'), 6000, run))
  assertAlive(orphanPid)
  assertAlive(installPid)
  assertAliveGroup(installPid)
  await writeFile(path.join(demo.root, 'release-failure'), 'go')
  const result = await exitOf(run)
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, /pnpm install --no-frozen-lockfile exited with 17/)
  assert.throws(() => process.kill(orphanPid, 0), { code: 'ESRCH' })
  assert.throws(() => process.kill(installPid, 0), { code: 'ESRCH' })
  const incompleteEnv = await readFile(path.join(demo.app, '.env'), 'utf8')
  assert.match(incompleteEnv, /APP_KEY=/)
  assert.equal(await readFile(path.join(demo.stateRoot, 'recipe.json'), 'utf8').catch(() => ''), '')
  await writeFile(path.join(demo.app, 'preserve-me.txt'), 'setup residue')
  delete demo.env.KIT_DEMO_TEST_FAIL_AT
  delete demo.env.KIT_DEMO_TEST_HOLD_FAILURE
  const retry = launch(demo, [], t)
  const retryResult = await exitOf(retry)
  assert.equal(retryResult.code, 1, retryResult.text)
  assert.match(retryResult.text, /Unrecognized demo workspace/)
  assert.equal(await readFile(path.join(demo.app, 'preserve-me.txt'), 'utf8'), 'setup residue')
  assert.equal(await readFile(path.join(demo.app, '.env'), 'utf8'), incompleteEnv)
})

test('handles Ctrl+C during setup and while serving, with no child or listener left behind', async (t) => {
  const setup = await fixture({ delayAt: 'build' })
  t.after(() => cleanupFixture(setup))
  const setupRun = launch(setup, [], t)
  await waitForLog(setup, /"command":"build"/)
  const setupPid = Number(await waitForFile(path.join(setup.root, 'child.pid'), 6000, setupRun))
  assertAlive(setupPid)
  assertAliveGroup(setupPid)
  setupRun.child.kill('SIGINT')
  const setupResult = await exitOf(setupRun)
  assert.equal(setupResult.code, 130, setupResult.text)
  assert.equal(await listening(setup.port), false)

  const serving = await fixture()
  t.after(() => cleanupFixture(serving))
  const serveRun = launch(serving, [], t)
  await waitForText(serveRun, 'Account Kit demo ready:')
  await waitForText(serveRun, 'operator@example.test / demo-operator-2026')
  assert.match(serveRun.text(), /operator@example\.test \/ demo-operator-2026/)
  const serverPid = Number(await waitForFile(path.join(serving.app, 'server.pid'), 6000, serveRun))
  assertAlive(serverPid)
  serveRun.child.kill('SIGINT')
  const serveResult = await exitOf(serveRun)
  assert.equal(serveResult.code, 130, serveResult.text)
  assert.throws(() => process.kill(serverPid, 0), { code: 'ESRCH' })
  assert.equal(await listening(serving.port), false)
})

test('races unrelated readiness responses with the owned server exit before and after headers', async (t) => {
  for (const mode of ['headers-held', 'body-held']) {
    const demo = await fixture({ unrelatedServer: true })
    t.after(() => cleanupFixture(demo))
    const run = launch(demo, [], t)
    await waitForFile(path.join(demo.root, 'owned-server-ready'), 6000, run)
    const unrelated = await startUnrelatedListener(demo.port, mode === 'headers-held')
    t.after(unrelated.close)
    await bounded(unrelated.requestSeen.promise, 3000, 'readiness request')
    if (mode === 'body-held')
      await bounded(unrelated.headersSent.promise, 3000, 'flushed readiness headers')
    assert.doesNotMatch(run.text(), /Account Kit demo ready:|demo-operator-2026/)
    await writeFile(path.join(demo.root, 'exit-owned-server'), 'exit')
    const result = await exitOf(run)
    assert.equal(result.code, 1, `${mode}: ${result.text}`)
    assert.match(result.text, /server exited before it became ready/)
    assert.doesNotMatch(result.text, /Account Kit demo ready:|demo-operator-2026/)
    assert.equal(unrelated.server.listening, true)
    await assertAcceptsConnection(demo.port)
    assert.equal(await listening(demo.port), true)
    await bounded(unrelated.responseClosed.promise, 3000, 'cancelled readiness response')
    await unrelated.close()
    await waitForListening(demo.port, false)
  }
})

test('reports an early serving process failure without waiting for the readiness deadline', async (t) => {
  const demo = await fixture({ serverFail: true })
  t.after(() => cleanupFixture(demo))
  const run = launch(demo, [], t)
  const result = await exitOf(run, 7000)
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, /server exited before it became ready/)
  assert.doesNotMatch(result.text, /ready:|demo-operator-2026/)
  assert.equal(await listening(demo.port), false)
})

test('keeps polling when the owned server returns a completed page without the demo marker', async (t) => {
  const demo = await fixture({ badPage: true })
  t.after(() => cleanupFixture(demo))
  const run = launch(demo, [], t)
  const serverPid = Number(await waitForFile(path.join(demo.app, 'server.pid'), 6000, run))
  const bodies = await waitForReadinessBodies(demo, 2, run)
  assert.equal(
    bodies.every(
      (entry) => entry.status === 200 && !entry.body.includes('data-demo="account-kit"')
    ),
    true
  )
  assertAlive(serverPid)
  assert.equal(run.child.exitCode, null)
  assert.doesNotMatch(run.text(), /Account Kit demo ready:|demo-operator-2026/)
  run.child.kill('SIGINT')
  const result = await exitOf(run)
  assert.equal(result.code, 130, result.text)
  assert.doesNotMatch(result.text, /Account Kit demo ready:|demo-operator-2026/)
})

test('maps SIGTERM during serving to exit 143 and stops the owned server group', async (t) => {
  const demo = await fixture()
  t.after(() => cleanupFixture(demo))
  const run = launch(demo, [], t)
  await waitForText(run, 'Account Kit demo ready:')
  const serverPid = Number(await waitForFile(path.join(demo.app, 'server.pid'), 6000, run))
  assertAlive(serverPid)
  run.child.kill('SIGTERM')
  const result = await exitOf(run)
  assert.equal(result.code, 143, result.text)
  assert.throws(() => process.kill(serverPid, 0), { code: 'ESRCH' })
  assert.equal(await listening(demo.port), false)
})

test('--reset refuses a listening port and otherwise removes only SQLite files', async (t) => {
  const busyPort = await freePort()
  const owner = createServer().listen(busyPort, '127.0.0.1')
  await once(owner, 'listening')
  t.after(() => new Promise((resolve) => owner.close(resolve)))
  const busy = await fixture({ port: busyPort })
  t.after(() => cleanupFixture(busy))
  await bootstrapMarker(busy)
  await writeFile(path.join(busy.app, 'tmp/db.sqlite3'), 'keep')
  const busyRun = launch(busy, ['--reset'], t)
  const busyResult = await exitOf(busyRun)
  assert.equal(busyResult.code, 1, busyResult.text)
  assert.equal(await readFile(path.join(busy.app, 'tmp/db.sqlite3'), 'utf8'), 'keep')
  assert.deepEqual(await commandLog(busy), [])

  const demo = await fixture()
  t.after(() => cleanupFixture(demo))
  await bootstrapMarker(demo)
  await mkdir(path.join(demo.app, 'tmp'), { recursive: true })
  for (const name of ['db.sqlite3', 'db.sqlite3-wal', 'db.sqlite3-shm', 'db.sqlite3-journal'])
    await writeFile(path.join(demo.app, 'tmp', name), 'old sqlite data')
  await writeFile(path.join(demo.app, 'tmp/keep.txt'), 'retain')
  await writeFile(
    path.join(demo.app, '.env'),
    `NODE_ENV=development\nPORT=${demo.port}\nHOST=127.0.0.1\nAPP_URL=http://127.0.0.1:${demo.port}\nDB_CLIENT=sqlite\nSESSION_DRIVER=database\nAPP_KEY=base64:preserve\n`
  )
  await mkdir(path.join(demo.app, 'database/migrations'), { recursive: true })
  await writeFile(
    path.join(demo.app, 'database/migrations/123_account_kit_keep.ts'),
    'keep migration'
  )
  const run = launch(demo, ['--reset'], t)
  await waitForText(run, 'Account Kit demo ready:')
  await waitForFile(path.join(demo.app, 'server.pid'), 6000, run)
  assert.equal(await readFile(path.join(demo.app, 'tmp/db.sqlite3'), 'utf8'), '{"users":[]}')
  for (const name of ['db.sqlite3-wal', 'db.sqlite3-shm', 'db.sqlite3-journal'])
    assert.equal(await readFile(path.join(demo.app, 'tmp', name), 'utf8').catch(() => ''), '')
  assert.equal(await readFile(path.join(demo.app, 'tmp/keep.txt'), 'utf8'), 'retain')
  assert.equal(
    await readFile(path.join(demo.app, '.env'), 'utf8').then((text) =>
      text.includes('APP_KEY=base64:preserve')
    ),
    true
  )
  assert.equal(
    await readFile(path.join(demo.app, 'database/migrations/123_account_kit_keep.ts'), 'utf8'),
    'keep migration'
  )
  assert.equal(
    await readFile(path.join(demo.stateRoot, 'recipe.json'), 'utf8').then(
      (text) => JSON.parse(text).schema
    ),
    1
  )
  await stopReady(run)
})

test('keeps the production artifact pin exact in source and performs no network fallback', async (t) => {
  const source = await readFile(wiringSource, 'utf8')
  assert.equal((source.match(new RegExp(kitSha, 'g')) ?? []).length, 1)
  assert.match(
    source,
    /kitReleaseUrl\s*=\s*\n\s*'https:\/\/github\.com\/Kevinjohn\/oss-adonisjs-account-kit\/releases\/download\/v0\.1\.3\/adonisjs-account-kit-0\.1\.3\.tgz'/
  )
  assert.match(source, /kitReleaseVersion\s*=\s*'0\.1\.3'/)
  const demo = await fixture()
  t.after(() => cleanupFixture(demo))
  demo.env.KIT_DEMO_TEST_RELEASE_URL = 'https://not-the-pinned-release.example.test/file.tgz'
  const run = launch(demo, [], t)
  const result = await exitOf(run)
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, /Unexpected outbound request blocked/)
  assert.equal(
    (await commandLog(demo)).some(
      (call) => call.kind === 'ace' || call.command.startsWith('install')
    ),
    false
  )
})
