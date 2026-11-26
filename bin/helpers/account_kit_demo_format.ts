import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runDemoCommand } from './account_kit_demo_process.ts'

const sourcePaths = [
  'adonisrc.ts',
  'config/auth.ts',
  'config/session.ts',
  'config/shield.ts',
  'start/kernel.ts',
  'start/env.ts',
]

function isKitMigration(name: string): boolean {
  return /^\d+_account_kit_(?:.+)\.ts$/.test(name)
}

export async function snapshotDemoMigrations(app: string): Promise<Set<string>> {
  const directory = join(app, 'database/migrations')
  try {
    const entries = await readdir(directory)
    return new Set(entries.filter(isKitMigration))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
}

export async function newDemoMigrationPaths(app: string, before: Set<string>): Promise<string[]> {
  const after = await snapshotDemoMigrations(app)
  return [...after]
    .filter((name) => !before.has(name))
    .sort()
    .map((name) => `database/migrations/${name}`)
}

export async function formatDemoSources(
  app: string,
  env: NodeJS.ProcessEnv,
  before: Set<string>,
  signal?: AbortSignal
): Promise<void> {
  const paths = [...sourcePaths, ...(await newDemoMigrationPaths(app, before))]
  await runDemoCommand('pnpm', ['exec', 'prettier', '--write', ...paths], app, env, signal)
}

export async function formatDemoSchema(
  app: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<void> {
  await runDemoCommand(
    'pnpm',
    ['exec', 'prettier', '--write', 'database/schema.ts'],
    app,
    env,
    signal
  )
}
