import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  overlay,
  wireAuth,
  wireKernel,
  wireProviders,
  wireSessionConfig,
  wireSessionImports,
  wireShield,
} from './account_kit_host_wiring.js'
import { ensureKitArtifact } from './account_kit_demo_artifact.js'
import { childDemoEnv, readDemoEnv } from './account_kit_demo_environment.js'
import { formatDemoSources, snapshotDemoMigrations } from './account_kit_demo_format.js'
import { runDemoCommand } from './account_kit_demo_process.js'
import {
  copyNativeDemo,
  rewriteDemoManifest,
  validateDemoWorkspace,
  writeDemoRecipe,
} from './account_kit_demo_workspace.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const native = join(root, 'examples/native-session')
const demo = join(root, 'examples/account-kit-demo')

export interface PreparedAccountKitDemo {
  workspace: string
  app: string
  env: NodeJS.ProcessEnv
  port: number
  url: string
}

function assertNode24(): void {
  if (Number(process.versions.node.split('.')[0]) !== 24)
    throw new Error(`The Account Kit demo requires Node.js 24; found ${process.versions.node}`)
}

export async function prepare(
  workspacePath: string,
  options: { port: number; signal?: AbortSignal }
): Promise<PreparedAccountKitDemo> {
  assertNode24()
  const { port, signal } = options
  const workspace = await validateDemoWorkspace(workspacePath)
  const app = join(workspace, 'app')
  const envFile = join(app, '.env')
  const template = join(demo, '.env.example')
  const existingEnv = await readDemoEnv(envFile)
  const prospective = existingEnv ?? (await readDemoEnv(template))
  if (!prospective) throw new Error(`Account Kit demo environment template is missing: ${template}`)
  if (!existingEnv) {
    prospective.PORT = String(port)
    prospective.APP_URL = `http://127.0.0.1:${port}`
  }
  const childEnv = childDemoEnv(prospective, process.env, port)
  signal?.throwIfAborted()
  await mkdir(workspace, { recursive: true })
  await runDemoCommand('pnpm', ['build'], root, childEnv, signal)
  await runDemoCommand(
    'pnpm',
    ['pack', '--out', join(workspace, 'masquerade.tgz')],
    root,
    childEnv,
    signal
  )
  await ensureKitArtifact(join(workspace, 'account-kit-0.1.3.tgz'), signal)
  signal?.throwIfAborted()
  await copyNativeDemo(native, app)
  await overlay(demo, app)
  await mkdir(join(app, 'tmp'), { recursive: true })
  if (!existsSync(join(app, 'pnpm-lock.yaml')))
    await copyFile(join(native, 'pnpm-lock.yaml'), join(app, 'pnpm-lock.yaml'))
  await rewriteDemoManifest(app)
  await wireAuth(app)
  await wireSessionImports(app)
  await wireSessionConfig(app)
  await wireKernel(app)
  await wireShield(app)
  await wireProviders(app)
  if (!existsSync(envFile)) {
    const source = await readFile(join(app, '.env.example'), 'utf8')
    await writeFile(
      envFile,
      source
        .replace(/^PORT=.*$/m, `PORT=${port}`)
        .replace(/^APP_URL=.*$/m, `APP_URL=http://127.0.0.1:${port}`)
    )
  }
  Object.assign(childEnv, childDemoEnv((await readDemoEnv(envFile))!, process.env, port))
  await runDemoCommand('pnpm', ['install', '--no-frozen-lockfile'], app, childEnv, signal)
  const fileEnv = (await readDemoEnv(envFile))!
  if (!fileEnv.APP_KEY || fileEnv.APP_KEY === 'replace_me_with_node_ace_generate_key') {
    await runDemoCommand(process.execPath, ['ace.js', 'generate:key'], app, childEnv, signal)
  }
  Object.assign(childEnv, childDemoEnv((await readDemoEnv(envFile))!, process.env, port))
  const existingMigrations = await snapshotDemoMigrations(app)
  await runDemoCommand(
    process.execPath,
    [
      'ace.js',
      'configure',
      'adonisjs-account-kit',
      '--users-table=users',
      '--user-id-type=integer',
    ],
    app,
    childEnv,
    signal
  )
  await runDemoCommand(
    process.execPath,
    ['ace.js', 'account-kit:admission:install', '--users-table=users', '--user-id-type=integer'],
    app,
    childEnv,
    signal
  )
  await formatDemoSources(app, childEnv, existingMigrations, signal)
  signal?.throwIfAborted()
  await writeDemoRecipe(workspace, port)
  return { workspace, app, env: childEnv, port, url: childEnv.APP_URL! }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspace = process.argv
    .find((arg) => arg.startsWith('--workspace='))
    ?.slice('--workspace='.length)
  const port = Number(
    process.argv.find((arg) => arg.startsWith('--port='))?.slice('--port='.length)
  )
  if (!workspace) throw new Error('Expected --workspace=<directory>')
  await prepare(workspace, { port })
}
