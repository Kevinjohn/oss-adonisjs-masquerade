import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runDemoCommand } from './helpers/account_kit_demo_process.js'
import { chromiumInstallArgs } from './helpers/example_chromium.js'

/**
 * Installs and checks one starter example built on Account Kit's examples, as CI does:
 * `pnpm test:with-account-kit --example=hypermedia`, `inertia_react`, `inertia_vue`, or `api`.
 */
const examples = ['hypermedia', 'inertia_react', 'inertia_vue', 'api']
const root = fileURLToPath(new URL('../', import.meta.url))
const name = process.argv.find((arg) => arg.startsWith('--example='))?.slice('--example='.length)
if (!name || !examples.includes(name))
  throw new Error(`Use --example=<${examples.join('|')}>; got ${name ?? 'nothing'}`)
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24')
const example = join(root, 'examples/with_account_kit', name)
const env: NodeJS.ProcessEnv = { ...process.env, HOST: '127.0.0.1', LIMITER_STORE: 'memory' }
if (name === 'api') env.NODE_ENV = 'test'

function run(label: string, args: string[]) {
  console.log(`[${name}] ${label}: pnpm ${args.join(' ')}`)
  const result = spawnSync('pnpm', args, { cwd: example, stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} failed (${result.status ?? result.signal})`)
}

run('pack Masquerade', ['kit:pack'])
// The packed archive's integrity changes with every build, so the lockfile cannot be frozen.
run('install', ['install', '--no-frozen-lockfile'])
if (!existsSync(join(example, '.env'))) {
  copyFileSync(join(example, '.env.example'), join(example, '.env'))
  run('generate key', ['exec', 'node', 'ace', 'generate:key', '--force'])
}
run('codegen', ['exec', 'node', 'ace', 'codegen'])
run('migrate', ['exec', 'node', 'ace', 'migration:run', '--force'])
if (name === 'api') run('format check', ['format:check'])
run('lint', ['lint'])
run('typecheck', ['typecheck'])
run('build', ['build'])

if (name === 'api') {
  run('test', ['test'])
} else {
  run('install Chromium', chromiumInstallArgs(example))

  const requireFromExample = createRequire(join(example, 'package.json'))
  const { createServer } = await import(pathToFileURL(requireFromExample.resolve('vite')).href)
  const vite = await createServer({
    root: example,
    configFile: join(example, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 0 },
  })
  const interruption = new AbortController()
  const stop = () => interruption.abort(new Error('Browser run interrupted'))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await vite.listen()
    console.log(`[${name}] Vite ready at ${vite.resolvedUrls?.local[0]}`)
    await runDemoCommand('pnpm', ['test'], example, env, interruption.signal)
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    await vite.close()
  }
}
