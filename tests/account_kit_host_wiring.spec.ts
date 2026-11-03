import { test } from '@japa/runner'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  overlay,
  wireAuth,
  wireKernel,
  wireProviders,
  wireRoutes,
  wireSessionConfig,
  wireSessionImports,
  wireShield,
} from '../bin/helpers/account_kit_host_wiring.js'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const nativeSession = join(repositoryRoot, 'examples/native-session')

async function createHost(root: string): Promise<string> {
  const app = join(root, 'app')
  await cp(nativeSession, app, {
    recursive: true,
    filter: (path) =>
      !relative(nativeSession, path)
        .split('/')
        .some((part) =>
          ['node_modules', 'build', 'tmp', '.adonisjs', 'pnpm-lock.yaml'].includes(part)
        ),
  })
  return app
}

async function applyWiring(app: string, routesPatch?: { anchor: string; imports: string[] }) {
  await overlay(join(repositoryRoot, 'examples/account-kit'), app)
  await wireRoutes(app, routesPatch)
  await wireAuth(app)
  await wireSessionImports(app)
  await wireSessionConfig(app)
  await wireKernel(app)
  await wireShield(app)
  await wireProviders(app)
}

test('applies optional Account Kit host route imports and other wiring', async ({ assert }) => {
  const root = await mkdtemp(join(tmpdir(), 'masquerade-account-kit-wiring-'))
  try {
    await wireRoutes(join(root, 'nonexistent-app'))

    const patchedApp = await createHost(root)
    await applyWiring(patchedApp, {
      anchor: "import './demo_json_routes.js'",
      imports: ['./custom_account_routes.js', './custom_fixture_routes.js'],
    })

    const routes = await readFile(join(patchedApp, 'start/routes.ts'), 'utf8')
    assert.include(
      routes,
      "import './demo_json_routes.js'\nimport './custom_account_routes.js'\nimport './custom_fixture_routes.js'"
    )
    assert.include(
      await readFile(join(patchedApp, 'config/auth.ts'), 'utf8'),
      ': { web: guards.web, web_effective: guards.web_effective, members: guards.members }) as unknown as typeof guards,'
    )
    const session = await readFile(join(patchedApp, 'config/session.ts'), 'utf8')
    assert.include(
      session,
      "import { protectManagedSessionConfig } from '@kevinjohn/adonisjs-account-kit/http'"
    )
    assert.include(session, 'export default protectManagedSessionConfig(sessionConfig, {')
    const kernel = await readFile(join(patchedApp, 'start/kernel.ts'), 'utf8')
    assert.include(kernel, '@adonisjs/auth/initialize_auth_middleware')
    assert.include(kernel, '@kevinjohn/adonisjs-masquerade/account-kit/middleware')
    assert.include(kernel, '#middleware/account_kit_admission_middleware')
    assert.isBelow(
      kernel.indexOf('@adonisjs/auth/initialize_auth_middleware'),
      kernel.indexOf('@kevinjohn/adonisjs-masquerade/account-kit/middleware')
    )
    assert.isBelow(
      kernel.indexOf('@kevinjohn/adonisjs-masquerade/account-kit/middleware'),
      kernel.indexOf('#middleware/account_kit_admission_middleware')
    )
    assert.include(
      await readFile(join(patchedApp, 'config/shield.ts'), 'utf8'),
      "process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens'"
    )
    assert.include(
      await readFile(join(patchedApp, 'adonisrc.ts'), 'utf8'),
      "() => import('@kevinjohn/adonisjs-account-kit/admission/provider')"
    )

    const alternateApp = await createHost(root)
    const alternateRoutes = join(alternateApp, 'start/routes.ts')
    const alternateSource = await readFile(
      join(repositoryRoot, 'examples/account-kit/start/account_kit_routes.ts'),
      'utf8'
    )
    await writeFile(alternateRoutes, alternateSource)
    await applyWiring(alternateApp)
    assert.equal(await readFile(alternateRoutes, 'utf8'), alternateSource)

    await assert.rejects(
      () => wireRoutes(alternateApp, { anchor: 'missing-anchor', imports: ['./route.js'] }),
      /Fixture seam changed:.*missing-anchor/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
