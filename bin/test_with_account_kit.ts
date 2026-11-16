import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromiumInstallArgs } from './helpers/example_chromium.js'
import { spawnVite, stopOwnedVite, waitForViteAddress } from './helpers/owned_vite.js'

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

  const vite = spawnVite(example, env)
  try {
    const address = await waitForViteAddress(vite)
    console.log(`[${name}] Vite ready at ${address}`)
    run('test', ['test'])
  } finally {
    stopOwnedVite(vite)
  }
}
