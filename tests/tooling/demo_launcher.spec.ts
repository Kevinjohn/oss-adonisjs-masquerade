import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from '@japa/runner'
import { fileURLToPath } from 'node:url'
import { assertNodeVersion } from '../../bin/demo.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const launcherPath = path.join(repoRoot, 'bin/demo.ts')
const currentNode = process.execPath

test('requires Node 24 before demo setup', () => {
  assert.doesNotThrow(() => assertNodeVersion('24.0.0'))
  assert.doesNotThrow(() => assertNodeVersion('25.2.1'))
  assert.throws(() => assertNodeVersion('23.11.0'), /requires Node\.js 24 or newer/)
  assert.throws(() => assertNodeVersion('unknown'), /requires Node\.js 24 or newer/)
}).timeout(30_000)

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) =>
    server.listen(0, '127.0.0.1', resolve).once('error', reject)
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP port address')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

type FixtureOptions = {
  port?: number
  env?: string
  server?: boolean
  envOverrides?: NodeJS.ProcessEnv
  failAt?: string
  startupFail?: boolean
  startupDelay?: number
  badPage?: boolean
  seedDelay?: number
  failReap?: boolean
  termResistantOrphan?: boolean
  serverExitFail?: boolean
  missingAt?: 'root-lock' | 'env-example' | 'example-lock' | 'tarball'
  filesystemFailure?: 'env-example-eacces' | 'example-lock-eio' | 'tarball-eio' | 'tarball-eacces'
}

type DemoFixture = {
  directory: string
  root: string
  example: string
  port: number
  env: NodeJS.ProcessEnv
  logPath: string
  firstEnv?: string
}

async function fixture(options: FixtureOptions = {}): Promise<DemoFixture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'masquerade-demo-'))
  const root = path.join(directory, 'checkout')
  const example = path.join(root, 'examples/native-session')
  const bin = path.join(directory, 'bin')
  await mkdir(example, { recursive: true })
  await mkdir(bin, { recursive: true })
  await mkdir(path.join(root, 'bin'), { recursive: true })
  await mkdir(path.join(root, 'tmp'), { recursive: true })
  await writeFile(path.join(root, 'bin/demo.ts'), await readFile(launcherPath))
  await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  const port = options.port ?? (await freePort())
  const envExample = `NODE_ENV=development\nPORT=${port}\nHOST=localhost\nAPP_URL=http://\${HOST}:\${PORT}\nAPP_KEY=replace_me_with_node_ace_generate_key\n`
  await writeFile(path.join(example, '.env.example'), envExample)
  await writeFile(
    path.join(example, 'pnpm-lock.yaml'),
    `
  '@kevinjohn/adonisjs-masquerade@file:../../tmp/native-session-package.tgz':
    resolution: {integrity: sha512-old, tarball: file:../../tmp/native-session-package.tgz}
  unrelated@1.0.0:
    resolution: {integrity: sha512-preserve-this}
`
  )
  await writeFile(
    path.join(example, 'state.json'),
    JSON.stringify({ users: [{ email: 'unrelated@example.test' }] })
  )
  if (options.env !== undefined) await writeFile(path.join(example, '.env'), options.env)
  if (options.server !== false) {
    await writeFile(
      path.join(example, 'server.js'),
      `
      import { createServer } from 'node:http'
      import { writeFile } from 'node:fs/promises'
      const port = Number(process.env.PORT)
      const startupDelay = Number(process.env.DEMO_TEST_STARTUP_DELAY ?? 0)
      const server = createServer((request, response) => {
        if (request.url === '/') {
          response.writeHead(200, { 'content-type': 'text/html' })
          response.end(process.env.DEMO_TEST_BAD_PAGE === '1' ? '<h1>Different application</h1>' : '<span>Server ready</span><p>Welcome to the power of a Hypermedia app.</p>')
        } else { response.writeHead(404).end() }
      })
      setTimeout(() => server.listen(port, '127.0.0.1', async () => {
        // Tests wait for server.pid, so it is written last.
        await writeFile(
          'effective-config.json',
          JSON.stringify({ APP_URL: process.env.APP_URL, HOST: process.env.HOST, PORT: process.env.PORT })
        )
        await writeFile('server.pid', String(process.pid))
      }), startupDelay)
    `
    )
  }
  await writeFile(
    path.join(example, 'orphan.js'),
    "import { createServer } from 'node:http'\nimport { writeFile } from 'node:fs/promises'\nconst server = createServer((_request, response) => response.end('orphan'))\nawait writeFile('orphan.pid', String(process.pid))\nserver.listen(Number(process.env.PORT), '127.0.0.1')\n"
  )
  await writeFile(
    path.join(example, 'term-resistant.js'),
    "import { writeFile } from 'node:fs/promises'\nprocess.on('SIGTERM', () => {})\nawait writeFile('orphan.pid', String(process.pid))\nsetInterval(() => {}, 1000)\n"
  )
  if (options.missingAt === 'root-lock') await rm(path.join(root, 'pnpm-lock.yaml'))
  if (options.missingAt === 'env-example') await rm(path.join(example, '.env.example'))
  if (options.missingAt === 'example-lock') await rm(path.join(example, 'pnpm-lock.yaml'))
  if (options.filesystemFailure === 'example-lock-eio') {
    await rm(path.join(example, 'pnpm-lock.yaml'))
    await symlink('/proc/self/mem', path.join(example, 'pnpm-lock.yaml'))
  }
  await writeFile(
    path.join(example, 'ace'),
    `
    import { readFile, writeFile } from 'node:fs/promises'
    const command = process.argv[2]
    const logPath = process.env.DEMO_TEST_LOG
    await writeFile(logPath, (await readFile(logPath, 'utf8').catch(() => '')) + command + '\\n')
    if (process.env.DEMO_TEST_FAIL_AT === command) process.exit(17)
    if (command === 'generate:key') {
      const text = await readFile('.env', 'utf8')
      await writeFile('.env', text.replace('replace_me_with_node_ace_generate_key', 'base64:existing-valid-key'))
    }
    if (command === 'migration:run') await writeFile('migrations-ran', 'yes')
    if (command === 'demo:seed') {
      await writeFile('seed-started', 'yes')
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.DEMO_TEST_SEED_DELAY ?? 0)))
      const state = JSON.parse(await readFile('state.json'))
      state.demoSeeded = true
      await writeFile('state.json', JSON.stringify(state))
    }
  `
  )
  const pnpmScript = `#!${currentNode}
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const args = process.argv.slice(2)
const command = args.join(' ')
const logPath = process.env.DEMO_TEST_LOG
await writeFile(logPath, (await import('node:fs/promises').then(({readFile}) => readFile(logPath, 'utf8').catch(() => ''))) + 'pnpm ' + command + '\\n')
if (process.env.DEMO_TEST_FAIL_AT && command.includes(process.env.DEMO_TEST_FAIL_AT)) {
  if (args[0] === 'build') {
    const example = path.join(process.cwd(), 'examples/native-session')
    const orphanScript = process.env.DEMO_TEST_RESISTANT_ORPHAN === '1' ? 'term-resistant.js' : 'orphan.js'
    spawn(process.execPath, [path.join(example, orphanScript)], { cwd: example, env: process.env, stdio: 'ignore' })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(path.join(example, 'orphan.pid'), 'utf8').catch(() => '')) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  process.exit(17)
}
if (args[0] === 'pack:fixture') {
  await mkdir(path.join(process.cwd(), 'tmp'), { recursive: true })
  const tarball = path.join(process.cwd(), 'tmp/native-session-package.tgz')
  if (process.env.DEMO_TEST_SKIP_TARBALL !== '1') await writeFile(tarball, 'tarball')
  if (process.env.DEMO_TEST_TARBALL_EIO === '1') {
    await import('node:fs/promises').then(({ rm, symlink }) => rm(tarball).then(() => symlink('/proc/self/mem', tarball)))
  }
  if (process.env.DEMO_TEST_TARBALL_EACCES === '1') {
    await import('node:fs/promises').then(({ chmod }) => chmod(tarball, 0))
  }
  if (process.env.DEMO_TEST_LOCK_EIO === '1') {
    const lockfile = path.join(process.cwd(), 'examples/native-session/pnpm-lock.yaml')
    await import('node:fs/promises').then(({ rm, symlink }) => rm(lockfile).then(() => symlink('/proc/self/mem', lockfile)))
  }
}
if (args[0] === 'dev') {
  if (process.env.DEMO_TEST_STARTUP_FAIL === '1') process.exit(19)
  if (process.env.DEMO_TEST_SERVER_EXIT_FAIL === '1') {
    const script = process.env.DEMO_TEST_RESISTANT_ORPHAN === '1' ? 'term-resistant.js' : 'orphan.js'
    spawn(process.execPath, [script], { cwd: process.cwd(), env: process.env, stdio: 'ignore' })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(path.join(process.cwd(), 'orphan.pid'), 'utf8').catch(() => '')) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    process.exit(17)
  }
  const serverScript = process.env.DEMO_TEST_RESISTANT_ORPHAN === '1' ? 'term-resistant.js' : 'server.js'
  const child = spawn(process.execPath, [serverScript], { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
  process.on('SIGTERM', () => child.kill('SIGTERM'))
  process.on('SIGINT', () => child.kill('SIGINT'))
  child.on('exit', (code) => process.exit(code ?? 1))
}
`
  const pnpmPath = path.join(bin, 'pnpm')
  await writeFile(pnpmPath, pnpmScript, { mode: 0o755 })
  const logPath = path.join(directory, 'commands.log')
  await writeFile(logPath, '')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: bin,
    DEMO_TEST_LOG: logPath,
  }
  for (const name of ['NODE_ENV', 'PORT', 'APP_KEY', 'DB_CLIENT', 'HOST']) delete env[name]
  Object.assign(env, options.envOverrides)
  if (options.failAt) env.DEMO_TEST_FAIL_AT = options.failAt
  if (options.startupFail) env.DEMO_TEST_STARTUP_FAIL = '1'
  if (options.startupDelay) env.DEMO_TEST_STARTUP_DELAY = String(options.startupDelay)
  if (options.badPage) env.DEMO_TEST_BAD_PAGE = '1'
  if (options.seedDelay) env.DEMO_TEST_SEED_DELAY = String(options.seedDelay)
  if (options.failReap) {
    const shimPath = path.join(directory, 'fail-reap.cjs')
    await writeFile(
      shimPath,
      `const originalKill = process.kill.bind(process)\nlet finalGroup = null\nprocess.kill = (pid, signal) => {\n  if (pid < 0 && signal === 'SIGKILL') { finalGroup = pid; return originalKill(pid, signal) }\n  if (pid === finalGroup && signal === 0) return true\n  return originalKill(pid, signal)\n}\n`
    )
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --require=${shimPath}`.trim()
  }
  if (options.termResistantOrphan) env.DEMO_TEST_RESISTANT_ORPHAN = '1'
  if (options.serverExitFail) env.DEMO_TEST_SERVER_EXIT_FAIL = '1'
  if (options.missingAt === 'tarball') env.DEMO_TEST_SKIP_TARBALL = '1'
  if (options.filesystemFailure === 'tarball-eio') env.DEMO_TEST_TARBALL_EIO = '1'
  if (options.filesystemFailure === 'tarball-eacces') env.DEMO_TEST_TARBALL_EACCES = '1'
  if (options.filesystemFailure === 'example-lock-eio') env.DEMO_TEST_LOCK_EIO = '1'
  if (options.filesystemFailure === 'env-example-eacces') await chmod(example, 0)
  return { directory, root, example, port, env, logPath }
}

function launch(
  demo: DemoFixture,
  args: string[] = [],
  options: { uid?: number; gid?: number } = {}
): ChildProcess {
  return spawn(currentNode, [path.join(demo.root, 'bin/demo.ts'), ...args], {
    cwd: demo.root,
    env: demo.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

async function outputOf(child: ChildProcess): Promise<{ text: () => string }> {
  let output = ''
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk
  })
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk
  })
  return { text: () => output }
}

async function collectExit(
  child: ChildProcess,
  output: { text: () => string }
): Promise<{ code: number | null; signal: NodeJS.Signals | null; text: string }> {
  const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null]
  return { code, signal, text: output.text() }
}

async function waitForFile(filePath: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, 'utf8')
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function waitForText(
  output: { text: () => string },
  expected: string,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (output.text().includes(expected)) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for output: ${expected}\n${output.text()}`)
}

async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createServer()
    socket.once('error', (error) => resolve((error as NodeJS.ErrnoException).code === 'EADDRINUSE'))
    socket.listen({ host: '127.0.0.1', port, exclusive: true }, () =>
      socket.close(() => resolve(false))
    )
  })
}

test('bootstraps a clean checkout, serves its app, and preserves key and unrelated data on repeat launch', async ({
  cleanup,
}) => {
  const demo = await fixture()
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  let activeChild: ChildProcess | undefined
  cleanup(async () => {
    if (!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null) return
    activeChild.kill('SIGTERM')
    await once(activeChild, 'exit')
  })

  for (let iteration = 0; iteration < 2; iteration++) {
    await rm(path.join(demo.example, 'server.pid'), { force: true })
    const child = (activeChild = launch(demo))
    const output = await outputOf(child)
    try {
      await waitForFile(path.join(demo.example, 'server.pid'))
    } catch (error) {
      throw new Error(
        `${error.message}\n${output.text()}\n${await readFile(demo.logPath, 'utf8').catch(() => '')}`
      )
    }
    const page = await fetch(`http://127.0.0.1:${demo.port}/`)
    assert.equal(page.status, 200)
    await waitForFile(demo.logPath)
    const envText = await readFile(path.join(demo.example, '.env'), 'utf8')
    assert.match(envText, /APP_KEY=base64:existing-valid-key/)
    assert.equal(envText.includes('APP_URL=http://${HOST}:${PORT}'), false)
    if (iteration === 0) demo.firstEnv = envText
    else assert.equal(envText, demo.firstEnv)
    const state = JSON.parse(await readFile(path.join(demo.example, 'state.json'), 'utf8'))
    assert.equal(state.demoSeeded, true)
    assert.deepEqual(state.users, [{ email: 'unrelated@example.test' }])
    const commands = await readFile(demo.logPath, 'utf8')
    assert.match(commands, /pnpm install --frozen-lockfile/)
    assert.equal(commands.match(/pnpm install --frozen-lockfile/g)?.length, 2 * (iteration + 1))
    assert.doesNotMatch(commands, /--no-frozen-lockfile/)
    assert.match(commands, /migration:run/)
    assert.match(commands, /demo:seed/)
    assert.doesNotMatch(commands, /demo:reset/)
    const exampleLock = await readFile(path.join(demo.example, 'pnpm-lock.yaml'), 'utf8')
    const expectedIntegrity = createHash('sha512')
      .update(await readFile(path.join(demo.root, 'tmp/native-session-package.tgz')))
      .digest('base64')
    assert.match(
      exampleLock,
      new RegExp(`integrity: sha512-${expectedIntegrity.replace(/[+/=]/g, '\\$&')}, tarball:`)
    )
    assert.match(exampleLock, /integrity: sha512-preserve-this/)
    await waitForText(output, 'operator@example.test / demo-operator-2026')
    assert.match(output.text(), /operator@example\.test \/ demo-operator-2026/)
    child.kill('SIGTERM')
    const result = await collectExit(child, output)
    assert.equal(result.code, 143)
    assert.equal(await isListening(demo.port), false)
    activeChild = undefined
  }
}).timeout(30_000)

test('refuses production and PostgreSQL settings before migration or seed', async ({ cleanup }) => {
  for (const [label, envText] of [
    ['production', 'NODE_ENV=production\nPORT=3333\nAPP_KEY=base64:kept\n'],
    ['PostgreSQL', 'NODE_ENV=development\nPORT=3333\nDB_CLIENT=pg\nAPP_KEY=base64:kept\n'],
    [
      'invalid APP_URL',
      'NODE_ENV=development\nPORT=3333\nAPP_KEY=base64:kept\nAPP_URL=not-a-url\n',
    ],
  ]) {
    const demo = await fixture({ env: envText })
    cleanup(() => rm(demo.directory, { recursive: true, force: true }))
    const child = launch(demo)
    const output = await outputOf(child)
    const result = await collectExit(child, output)
    assert.equal(result.code, 1, `${label}\n${result.text}`)
    assert.match(result.text, /NODE_ENV|SQLite|APP_URL/)
    assert.doesNotMatch(
      await readFile(demo.logPath, 'utf8').catch(() => ''),
      /migration:run|demo:seed/
    )
    assert.equal(
      await readFile(path.join(demo.example, 'migrations-ran'), 'utf8').catch(() => ''),
      ''
    )
  }
}).timeout(30_000)

test('resolves the documented APP_URL template in existing config without rewriting it', async ({
  cleanup,
}) => {
  const port = await freePort()
  const originalEnv = `NODE_ENV=development\nPORT=12345\nHOST=localhost\nAPP_URL=http://\${HOST}:\${PORT}\nAPP_KEY=base64:preserve-this-key\n`
  const demo = await fixture({
    port,
    env: originalEnv,
    envOverrides: { HOST: '127.0.0.1', PORT: String(port) },
  })
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  const child = launch(demo)
  const output = await outputOf(child)
  await waitForFile(path.join(demo.example, 'server.pid'))
  child.kill('SIGINT')
  const result = await collectExit(child, output)
  assert.equal(result.code, 130, result.text)
  assert.deepEqual(
    JSON.parse(await readFile(path.join(demo.example, 'effective-config.json'), 'utf8')),
    { APP_URL: `http://127.0.0.1:${port}`, HOST: '127.0.0.1', PORT: String(port) }
  )
  assert.equal(await readFile(path.join(demo.example, '.env'), 'utf8'), originalEnv)
  assert.match(
    await readFile(path.join(demo.example, 'state.json'), 'utf8'),
    /unrelated@example\.test/
  )

  await Promise.all([
    rm(path.join(demo.example, 'server.pid'), { force: true }),
    rm(path.join(demo.example, 'effective-config.json'), { force: true }),
  ])
  const repeat = launch(demo)
  const repeatOutput = await outputOf(repeat)
  await waitForFile(path.join(demo.example, 'server.pid'))
  repeat.kill('SIGINT')
  const repeatResult = await collectExit(repeat, repeatOutput)
  assert.equal(repeatResult.code, 130, repeatResult.text)
  assert.equal(await readFile(path.join(demo.example, '.env'), 'utf8'), originalEnv)
  assert.deepEqual(
    JSON.parse(await readFile(path.join(demo.example, 'effective-config.json'), 'utf8')),
    { APP_URL: `http://127.0.0.1:${port}`, HOST: '127.0.0.1', PORT: String(port) }
  )
  assert.match(
    await readFile(path.join(demo.example, 'state.json'), 'utf8'),
    /unrelated@example\.test/
  )
}).timeout(30_000)

for (const ownerHost of ['127.0.0.1', '0.0.0.0', '::', '::1']) {
  test(`reports a local port occupied on ${ownerHost} without stopping its owner or touching the database`, async ({
    cleanup,
  }) => {
    const port = await freePort()
    const owner = createServer().listen(port, ownerHost)
    await once(owner, 'listening')
    cleanup(() => new Promise<void>((resolve) => owner.close(() => resolve())))
    const demo = await fixture({
      port,
      env: `NODE_ENV=development\nPORT=${port}\nAPP_KEY=base64:kept\nAPP_URL=http://127.0.0.1:${port}\n`,
    })
    cleanup(() => rm(demo.directory, { recursive: true, force: true }))
    const child = launch(demo)
    const output = await outputOf(child)
    const result = await collectExit(child, output)
    assert.equal(result.code, 1, result.text)
    assert.match(result.text, new RegExp(`Port ${port} is already in use`))
    assert.equal(owner.listening, true)
    assert.equal(
      await readFile(path.join(demo.example, 'migrations-ran'), 'utf8').catch(() => ''),
      ''
    )
  }).timeout(30_000)
}

test('reports a port taken during setup instead of starting the server', async ({ cleanup }) => {
  const port = await freePort()
  const demo = await fixture({
    port,
    env: `NODE_ENV=development\nPORT=${port}\nAPP_KEY=base64:kept\nAPP_URL=http://127.0.0.1:${port}\n`,
    seedDelay: 1500,
  })
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  const child = launch(demo)
  cleanup(() => {
    child.kill('SIGINT')
  })
  const output = await outputOf(child)
  const exited = collectExit(child, output)
  await waitForFile(path.join(demo.example, 'migrations-ran'))
  const owner = createServer().listen(port, '0.0.0.0')
  await once(owner, 'listening')
  cleanup(() => new Promise<void>((resolve) => owner.close(() => resolve())))
  const result = await exited
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, new RegExp(`Port ${port} is already in use`))
  assert.equal(await readFile(path.join(demo.example, 'server.pid'), 'utf8').catch(() => ''), '')
}).timeout(30_000)

test('reports setup failures and terminates its owned child process group', async ({ cleanup }) => {
  const demo = await fixture({ failAt: 'build' })
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  const child = launch(demo)
  const output = await outputOf(child)
  const result = await collectExit(child, output)
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, /pnpm build exited with code 17/)
  const orphanFile = path.join(demo.example, 'orphan.pid')
  const orphanPidText = await readFile(orphanFile, 'utf8').catch(async (error) => {
    throw new Error(
      `Expected orphan process to start before launcher cleanup: ${error.message}; log: ${await readFile(demo.logPath, 'utf8')}`
    )
  })
  const orphanPid = Number(orphanPidText)
  assert.throws(() => process.kill(orphanPid, 0), { code: 'ESRCH' })
  assert.equal(await isListening(demo.port), false)
  assert.doesNotMatch(await readFile(demo.logPath, 'utf8'), /migration:run|demo:seed/)
}).timeout(30_000)

test('stops the serving process on interruption and preserves a malformed configuration', async ({
  cleanup,
}) => {
  const port = await freePort()
  const demo = await fixture({
    env: `NODE_ENV=development\nPORT=${port}\nAPP_KEY=base64:kept\nAPP_URL=http://127.0.0.1:${port}\n`,
  })
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  const child = launch(demo)
  const output = await outputOf(child)
  const pid = Number(await waitForFile(path.join(demo.example, 'server.pid')))
  child.kill('SIGINT')
  const result = await collectExit(child, output)
  assert.equal(result.code, 130)
  assert.equal(await isListening(demo.port), false)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })

  const malformed = await fixture({ env: 'NODE_ENV development\nAPP_KEY=base64:kept\n' })
  cleanup(() => rm(malformed.directory, { recursive: true, force: true }))
  const malformedChild = launch(malformed)
  const malformedOutput = await outputOf(malformedChild)
  const malformedResult = await collectExit(malformedChild, malformedOutput)
  assert.equal(malformedResult.code, 1, malformedResult.text)
  assert.match(malformedResult.text, /is malformed/)
  assert.equal(
    await readFile(path.join(malformed.example, '.env'), 'utf8'),
    'NODE_ENV development\nAPP_KEY=base64:kept\n'
  )
  assert.equal(await readFile(malformed.logPath, 'utf8').catch(() => ''), '')
}).timeout(30_000)

test('stops its process group when interrupted while the server is still starting', async ({
  cleanup,
}) => {
  const demo = await fixture({ startupDelay: 5000 })
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  const child = launch(demo)
  const output = await outputOf(child)
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const commands = await readFile(demo.logPath, 'utf8').catch(() => '')
    if (commands.includes('pnpm dev')) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.match(await readFile(demo.logPath, 'utf8'), /pnpm dev/)
  child.kill('SIGTERM')
  const result = await collectExit(child, output)
  assert.equal(result.code, 143)
  assert.equal(await isListening(demo.port), false)
  assert.equal(await readFile(path.join(demo.example, 'server.pid'), 'utf8').catch(() => ''), '')
}).timeout(30_000)

test('does not report readiness for an unrelated successful listener', async ({ cleanup }) => {
  const demo = await fixture({ badPage: true })
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  let activeChild: ChildProcess | undefined
  cleanup(async () => {
    if (!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null) return
    activeChild.kill('SIGTERM')
    await once(activeChild, 'exit')
  })
  activeChild = launch(demo)
  const output = await outputOf(activeChild)
  await waitForFile(path.join(demo.example, 'server.pid'))
  const response = await fetch(`http://127.0.0.1:${demo.port}/`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Different application/)
  await new Promise((resolve) => setTimeout(resolve, 400))
  assert.doesNotMatch(output.text(), /Demo ready:/)
  activeChild.kill('SIGTERM')
  const result = await collectExit(activeChild, output)
  assert.equal(result.code, 143)
}).timeout(30_000)

test('maps only missing demo inputs and preserves unexpected filesystem failures', async ({
  cleanup,
}) => {
  for (const [missingAt, expected] of [
    ['root-lock', 'complete repository checkout'],
    ['env-example', 'configuration template'],
    ['example-lock', 'missing pnpm-lock.yaml'],
    ['tarball', 'local package tarball was not created'],
  ] as const) {
    const demo = await fixture({ missingAt })
    cleanup(() => rm(demo.directory, { recursive: true, force: true }))
    const child = launch(demo)
    const output = await outputOf(child)
    const result = await collectExit(child, output)
    assert.equal(result.code, 1, `${missingAt}\n${result.text}`)
    assert.match(result.text, new RegExp(expected))
  }

  for (const [filesystemFailure, code] of [
    ['example-lock-eio', 'EIO'],
    ['tarball-eio', 'EIO'],
    ['tarball-eacces', 'EACCES'],
  ] as const) {
    const demo = await fixture({ filesystemFailure })
    cleanup(() => rm(demo.directory, { recursive: true, force: true }))
    const child = launch(demo)
    const output = await outputOf(child)
    const result = await collectExit(child, output)
    assert.equal(result.code, 1, `${filesystemFailure}\n${result.text}`)
    assert.match(result.text, new RegExp(code))
    assert.doesNotMatch(result.text, /missing pnpm-lock|local package tarball was not created/)
  }

  const inaccessible = await fixture({ filesystemFailure: 'env-example-eacces' })
  await chmod(inaccessible.directory, 0o755)
  cleanup(async () => {
    await chmod(inaccessible.example, 0o755)
    await rm(inaccessible.directory, { recursive: true, force: true })
  })
  const inaccessibleChild = launch(inaccessible, [], {
    uid: process.getuid() === 0 ? 65534 : process.getuid(),
    gid: process.getgid() === 0 ? 65534 : process.getgid(),
  })
  const inaccessibleOutput = await outputOf(inaccessibleChild)
  const inaccessibleResult = await collectExit(inaccessibleChild, inaccessibleOutput)
  assert.equal(inaccessibleResult.code, 1, inaccessibleResult.text)
  assert.match(inaccessibleResult.text, /EACCES/)
  assert.doesNotMatch(inaccessibleResult.text, /configuration template/)
}).timeout(30_000)

test('reports setup and server-exit reap failures alongside their primary errors', async ({
  cleanup,
}) => {
  const setup = await fixture({ failAt: 'build', failReap: true, termResistantOrphan: true })
  cleanup(() => rm(setup.directory, { recursive: true, force: true }))
  const setupChild = launch(setup)
  const setupOutput = await outputOf(setupChild)
  const setupResult = await collectExit(setupChild, setupOutput)
  assert.equal(setupResult.code, 1, setupResult.text)
  assert.match(setupResult.text, /pnpm build exited with code 17/)
  assert.match(setupResult.text, /Failed to reap owned process group/)
  assert.doesNotMatch(setupResult.text, /UnhandledPromiseRejection|unhandledRejection/)

  const server = await fixture({
    serverExitFail: true,
    failReap: true,
    termResistantOrphan: true,
  })
  cleanup(() => rm(server.directory, { recursive: true, force: true }))
  const serverChild = launch(server)
  const serverOutput = await outputOf(serverChild)
  const serverResult = await collectExit(serverChild, serverOutput)
  assert.equal(serverResult.code, 1, serverResult.text)
  assert.match(serverResult.text, /server exited before becoming ready/)
  assert.match(serverResult.text, /Failed to reap owned process group/)
  assert.doesNotMatch(serverResult.text, /UnhandledPromiseRejection|unhandledRejection/)
}).timeout(30_000)

test('reports signal cleanup reap failures and keeps the first signal exit code', async ({
  cleanup,
}) => {
  const demo = await fixture({ failReap: true, termResistantOrphan: true })
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  const child = launch(demo)
  const output = await outputOf(child)
  await waitForFile(path.join(demo.example, 'orphan.pid'))
  child.kill('SIGTERM')
  const result = await collectExit(child, output)
  assert.equal(result.code, 143, result.text)
  assert.match(result.text, /Demo cleanup failed:.*Failed to reap owned process group/s)
  assert.doesNotMatch(result.text, /UnhandledPromiseRejection|unhandledRejection/)
}).timeout(30_000)

test('settles a server spawn failure during readiness without an unhandled rejection', async ({
  cleanup,
}) => {
  const demo = await fixture({ seedDelay: 1000 })
  cleanup(() => rm(demo.directory, { recursive: true, force: true }))
  const child = launch(demo)
  const output = await outputOf(child)
  await waitForFile(path.join(demo.example, 'seed-started'))
  await rm(path.join(demo.directory, 'bin/pnpm'))
  const result = await collectExit(child, output)
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, /Could not start the demo server: spawn pnpm ENOENT/)
  assert.doesNotMatch(result.text, /UnhandledPromiseRejection|unhandledRejection/)
}).timeout(30_000)
