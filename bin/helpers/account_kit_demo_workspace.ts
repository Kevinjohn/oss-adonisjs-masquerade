import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const recipeSchema = 1

export async function validateDemoWorkspace(workspace: string): Promise<string> {
  const absolute = resolve(workspace)
  let entries: string[]
  try {
    entries = await readdir(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return absolute
    throw error
  }
  if (entries.length === 0) return absolute
  let valid = false
  try {
    const recipe = JSON.parse(await readFile(join(absolute, 'recipe.json'), 'utf8')) as {
      schema?: unknown
    }
    valid = recipe.schema === recipeSchema
  } catch {
    // An interrupted first preparation has no marker and is never claimed automatically.
  }
  if (!valid)
    throw new Error(
      `Unrecognized demo workspace ${absolute}. Inspect it, then move or remove it manually before retrying.`
    )
  return absolute
}

const excluded = new Set([
  'node_modules',
  'build',
  'tmp',
  '.adonisjs',
  'pnpm-lock.yaml',
  'tests',
  '.env',
  '.env.test',
])

export async function copyNativeDemo(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (
      excluded.has(entry.name) ||
      (entry.name === 'demo_json.js' && source.endsWith('/resources/js'))
    )
      continue
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) await copyNativeDemo(from, to)
    else if (entry.isFile()) await cp(from, to)
  }
}

export async function writeDemoRecipe(workspace: string, port: number): Promise<void> {
  await writeFile(
    join(workspace, 'recipe.json'),
    JSON.stringify(
      { schema: recipeSchema, port, packageManager: 'pnpm install --no-frozen-lockfile' },
      null,
      2
    ) + '\n'
  )
}

export async function rewriteDemoManifest(app: string): Promise<void> {
  const path = join(app, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as {
    dependencies: Record<string, string>
    allowScripts?: Record<string, boolean>
  }
  manifest.dependencies['adonisjs-masquerade'] = 'file:../masquerade.tgz'
  manifest.dependencies['adonisjs-account-kit'] = 'file:../account-kit-0.1.3.tgz'
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
  if (manifest.allowScripts) {
    const workspace = join(app, 'pnpm-workspace.yaml')
    const existing = await readFile(workspace, 'utf8')
    if (!existing.includes('allowBuilds:'))
      await writeFile(
        workspace,
        existing +
          '\nallowBuilds:\n' +
          Object.entries(manifest.allowScripts)
            .map(([name, value]) => `  '${name}': ${value}`)
            .join('\n') +
          '\n'
      )
  }
}
