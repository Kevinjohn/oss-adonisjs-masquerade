import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const kitReleaseUrl =
  'https://github.com/Kevinjohn/oss-adonisjs-account-kit/releases/download/v0.1.5/kevinjohn-adonisjs-account-kit-0.1.5.tgz'
// Expected candidate bytes; reconcile with the published scoped release before delivery.
export const kitReleaseSha256 = 'd124bfec0913fc05ee3df010e996ebca20d5633272c1f0cc8d602fc85e253d8b'
export const kitReleaseVersion = '0.1.5'
export const kitSourceRevision = '555c56cda66f3168477fec687c32e4ff87ae71de'

export async function overlay(sourceDir: string, destinationDir: string): Promise<void> {
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const from = join(sourceDir, entry.name)
    const to = join(destinationDir, entry.name)
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true })
      await overlay(from, to)
    } else if (entry.isFile()) await cp(from, to)
  }
}

export async function replace(path: string, oldText: string, newText: string): Promise<void> {
  const before = await readFile(path, 'utf8')
  if (!before.includes(oldText)) throw new Error(`Fixture seam changed: ${path}: ${oldText}`)
  await writeFile(path, before.replace(oldText, newText))
}

export async function rewriteManifest(
  app: string,
  versions: Record<string, string>,
  selectedProfile: string
): Promise<void> {
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
  for (const [name, version] of Object.entries(versions))
    (name === 'typescript' ? manifest.devDependencies : manifest.dependencies)[name] = version
  if (selectedProfile === 'floor') manifest.dependencies['@adonisjs/vite'] = '6.0.1'
  manifest.dependencies['@kevinjohn/adonisjs-masquerade'] = 'file:./masquerade.tgz'
  manifest.dependencies['@kevinjohn/adonisjs-account-kit'] = 'file:./account-kit.tgz'
  await writeFile(join(app, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(
    join(app, 'pnpm-workspace.yaml'),
    JSON.stringify({ overrides: versions, allowBuilds: manifest.allowScripts }, null, 2) + '\n'
  )
}

export async function wireRoutes(
  app: string,
  routesPatch?: { anchor: string; imports: string[] }
): Promise<void> {
  if (!routesPatch) return
  await replace(
    join(app, 'start/routes.ts'),
    routesPatch.anchor,
    [routesPatch.anchor, ...routesPatch.imports.map((path) => `import '${path}'`)].join('\n')
  )
}

export async function wireAuth(app: string): Promise<void> {
  await replace(
    join(app, 'config/auth.ts'),
    ': guards) as typeof guards,',
    ': { web: guards.web, web_effective: guards.web_effective, members: guards.members }) as unknown as typeof guards,'
  )
}

export async function wireSessionImports(app: string): Promise<void> {
  await replace(
    join(app, 'config/session.ts'),
    "import { defineConfig, stores } from '@adonisjs/session'",
    "import { defineConfig, stores } from '@adonisjs/session'\nimport { protectManagedSessionConfig } from '@kevinjohn/adonisjs-account-kit/http'"
  )
}

export async function wireSessionConfig(app: string): Promise<void> {
  await replace(
    join(app, 'config/session.ts'),
    'export default sessionConfig',
    "export default protectManagedSessionConfig(sessionConfig, {\n  verifyStore: (actual) => typeof actual === 'object' && actual !== null && actual.constructor.name === 'DatabaseStore',\n})"
  )
}

export async function wireKernel(app: string): Promise<void> {
  await replace(
    join(app, 'start/kernel.ts'),
    "  () => import('@adonisjs/auth/initialize_auth_middleware'),",
    "  () => import('@adonisjs/auth/initialize_auth_middleware'),\n  () => import('@kevinjohn/adonisjs-masquerade/account-kit/middleware'),\n  () => import('#middleware/account_kit_admission_middleware'),"
  )
}

export async function wireShield(app: string): Promise<void> {
  await replace(
    join(app, 'config/shield.ts'),
    '(routeName && bearerRouteNames.has(routeName)) ||',
    "(routeName && bearerRouteNames.has(routeName)) ||\n        (process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens' &&\n          ((routeName && routeName.startsWith('accountKit.')) || routePath === '/account/password' || routePath?.startsWith('/account/sessions/'))) ||"
  )
}

export async function wireProviders(app: string): Promise<void> {
  await replace(
    join(app, 'adonisrc.ts'),
    "    () => import('@kevinjohn/adonisjs-masquerade/masquerade_provider'),",
    "    () => import('@kevinjohn/adonisjs-masquerade/masquerade_provider'),\n    () => import('@kevinjohn/adonisjs-masquerade/account-kit/provider'),\n    () => import('@kevinjohn/adonisjs-account-kit/admission/provider'),"
  )
}
