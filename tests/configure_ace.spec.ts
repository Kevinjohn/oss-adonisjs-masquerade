import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { starterAuthConfig, starterKernel } from './helpers/starter_kit.ts'

test.group('Masquerade configure scaffold', () => {
  test('loads and executes the package hook through native Ace', async ({ assert }) => {
    const root = await mkdtemp(join(tmpdir(), 'masquerade-ace-configure-'))
    const previousProcessExitCode = process.exitCode
    try {
      await mkdir(join(root, 'config'), { recursive: true })
      await mkdir(join(root, 'start'), { recursive: true })
      await mkdir(join(root, 'node_modules/@kevinjohn'), { recursive: true })
      await mkdir(join(root, 'app/models'), { recursive: true })
      await writeFile(join(root, 'app/models/user.ts'), 'export default class User {}\n')
      await writeFile(join(root, 'config/auth.ts'), 'export default {}')
      await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n')
      await writeFile(
        join(root, 'adonisrc.ts'),
        `import { defineConfig } from '@adonisjs/core'
export default defineConfig({
  providers: [() => import('#providers/host_provider')],
  commands: [() => import('#commands/host_command')],
})\n`
      )
      await symlink(
        join(process.cwd(), 'node_modules/@adonisjs'),
        join(root, 'node_modules/@adonisjs'),
        'dir'
      )
      await symlink(process.cwd(), join(root, 'node_modules/@kevinjohn/adonisjs-masquerade'), 'dir')

      const ignitor = new IgnitorFactory()
        .withCoreProviders()
        .withCoreConfig()
        .merge({ rcFileContents: { commands: [configureCommandLoader] } })
        .create(pathToFileURL(root + '/'))
      await ignitor
        .ace()
        .configure(async (app) => {
          app.import = async (specifier: string) => {
            if (specifier === '@kevinjohn/adonisjs-masquerade')
              return import('@kevinjohn/adonisjs-masquerade')
            if (specifier === '@adonisjs/lucid') return import('@adonisjs/lucid')
            if (specifier === '@adonisjs/assembler/code_transformer')
              return import('@adonisjs/assembler/code_transformer')
            throw new Error('Unexpected package import: ' + specifier)
          }
        })
        .handle([
          'configure',
          '@kevinjohn/adonisjs-masquerade',
          '--namespace=ace_app',
          '--guard=web',
        ])
      assert.equal(process.exitCode, 0)
      process.exitCode = previousProcessExitCode

      const migrationRoot = join(root, 'database/migrations')
      const migrations = await readdir(migrationRoot)
      migrations.sort()
      assert.lengthOf(migrations, 2)
      assert.match(migrations[0], /^\d{13}_create_masquerade_modes\.ts$/)
      assert.match(migrations[1], /^\d{13}_create_masquerade_events\.ts$/)
      const migrationSources = await Promise.all(
        migrations.map(async (file) => {
          const source =
            '// Application-owned migration edit\n' +
            (await readFile(join(migrationRoot, file), 'utf8'))
          await writeFile(join(migrationRoot, file), source)
          return source
        })
      )

      await ignitor
        .ace()
        .configure(async (app) => {
          app.import = async (specifier: string) => {
            if (specifier === '@kevinjohn/adonisjs-masquerade')
              return import('@kevinjohn/adonisjs-masquerade')
            if (specifier === '@adonisjs/lucid') return import('@adonisjs/lucid')
            if (specifier === '@adonisjs/assembler/code_transformer')
              return import('@adonisjs/assembler/code_transformer')
            throw new Error('Unexpected package import: ' + specifier)
          }
        })
        .handle([
          'configure',
          '@kevinjohn/adonisjs-masquerade',
          '--namespace=ace_app',
          '--guard=web',
          '--force',
        ])
      assert.equal(process.exitCode, 0)

      assert.include(
        await readFile(join(root, 'config/masquerade.ts'), 'utf8'),
        'namespace: "ace_app"'
      )
      assert.include(
        await readFile(join(root, 'app/services/masquerade_user_provider.ts'), 'utf8'),
        'sessionUserProvider'
      )
      assert.sameMembers(await readdir(migrationRoot), migrations)
      assert.deepEqual(
        await Promise.all(migrations.map((file) => readFile(join(migrationRoot, file), 'utf8'))),
        migrationSources
      )
      const rcFile = await readFile(join(root, 'adonisrc.ts'), 'utf8')
      assert.include(rcFile, "'#providers/host_provider'")
      assert.include(rcFile, "'#commands/host_command'")
      assert.isBelow(
        rcFile.indexOf('#providers/masquerade_native_provider'),
        rcFile.indexOf('@kevinjohn/adonisjs-masquerade/masquerade_provider')
      )
      assert.equal(rcFile.match(/@kevinjohn\/adonisjs-masquerade\/masquerade_provider/g)?.length, 1)
      assert.equal(rcFile.match(/@kevinjohn\/adonisjs-masquerade\/commands/g)?.length, 1)
      assert.include(rcFile, '#providers/masquerade_native_provider')

      assert.isFalse(existsSync(join(root, 'app/middleware/masquerade_context_middleware.ts')))
      const middlewarePath = '@kevinjohn/adonisjs-masquerade/masquerade_context_middleware'
      const middlewareModule = await import(middlewarePath)
      assert.equal(typeof middlewareModule.default, 'function', JSON.stringify(middlewareModule))
      assert.equal(typeof middlewareModule.default.prototype.handle, 'function')
      const middleware = new middlewareModule.default()
      let continued = false
      await middleware.handle(
        { route: undefined, auth: { defaultGuard: 'web' } } as never,
        async () => {
          continued = true
        }
      )
      assert.isTrue(continued, 'the middleware subpath should load and invoke the package handler')
    } finally {
      process.exitCode = previousProcessExitCode
      await rm(root, { recursive: true, force: true })
    }
  })
    .timeout(10_000)
    // The generated app imports the compiled package; `pnpm test:built-exports` runs this after build.
    .skip(process.env.TEST_BUILT_EXPORTS !== '1', 'requires the built package')

  test('generates route drafts, preloads them and registers the banner middleware', async ({
    assert,
  }) => {
    const previousProcessExitCode = process.exitCode
    const host = await starterHost()
    const json = await starterHost()
    try {
      assert.equal(
        await runConfigure(host, ['--banner', '--form-controller', '--control-routes']),
        0
      )
      assert.equal(await runConfigure(json, ['--control-routes']), 0)
      assert.equal(await readFile(join(host, 'config/auth.ts'), 'utf8'), starterAuthConfig)
      assert.include(
        await readFile(join(host, 'start/kernel.ts'), 'utf8'),
        "() => import('#middleware/share_masquerade_status_middleware')"
      )
      assert.equal(await readFile(join(json, 'start/kernel.ts'), 'utf8'), starterKernel)
      assert.include(
        await readFile(join(host, 'app/middleware/share_masquerade_status_middleware.ts'), 'utf8'),
        'runtime.selectGuard(ctx).kind'
      )
      assert.include(
        await readFile(join(host, 'resources/views/components/masquerade/banner.edge'), 'utf8'),
        'masquerade.contextToken'
      )
      assert.include(
        await readFile(join(host, 'app/controllers/masquerade_form_controller.ts'), 'utf8'),
        '#transition'
      )
      const routes = await readFile(join(host, 'start/masquerade_form_routes.ts'), 'utf8')
      assert.match(routes, /guards: \[["']web["']\]/)
      assert.include(routes, "import('#controllers/masquerade_form_controller')")
      for (const route of ['status', 'start', 'stop']) assert.include(routes, `'${route}'`)
      const jsonRoutes = await readFile(join(json, 'start/masquerade_routes.ts'), 'utf8')
      assert.include(
        jsonRoutes,
        "import runtime from '@kevinjohn/adonisjs-masquerade/services/main'"
      )
      assert.isFalse(existsSync(join(json, 'app/controllers/masquerade_form_controller.ts')))
      assert.match(
        await readFile(join(host, 'start/masquerade_limiter.ts'), 'utf8'),
        /ctx.auth.use\(["']web["']\).getUserOrFail\(\)/
      )
      assert.include(
        await readFile(join(host, 'adonisrc.ts'), 'utf8'),
        "import('#start/masquerade_form_routes')"
      )
      assert.include(
        await readFile(join(json, 'adonisrc.ts'), 'utf8'),
        "import('#start/masquerade_routes')"
      )
      assert.deepEqual(await bootGeneratedRuntime(host, {}, true), {
        booted: true,
        guard: 'web_effective',
      })
    } finally {
      process.exitCode = previousProcessExitCode
      await rm(host, { recursive: true, force: true })
      await rm(json, { recursive: true, force: true })
    }
  })
    .timeout(20_000)
    .skip(process.env.TEST_BUILT_EXPORTS !== '1', 'requires the built package')

  test('uses custom host directories for preflight and generation', async ({ assert }) => {
    const previousProcessExitCode = process.exitCode
    const host = await starterHost()
    const directories = {
      config: 'settings',
      start: 'bootstrap',
      models: 'domain/models',
      services: 'domain/services',
      providers: 'bootstrap/providers',
      middleware: 'domain/middleware',
      httpControllers: 'domain/controllers',
      views: 'templates',
      migrations: 'schema',
    }
    try {
      await rename(join(host, 'config'), join(host, directories.config))
      await rename(join(host, 'start'), join(host, directories.start))
      await mkdir(join(host, 'domain'))
      await rename(join(host, 'app/models'), join(host, directories.models))
      // Source codemods read the directories from adonisrc.ts, as in a real application.
      const rcFile = join(host, 'adonisrc.ts')
      const rcSource = await readFile(rcFile, 'utf8')
      await writeFile(
        rcFile,
        rcSource.replace(
          'export default defineConfig({',
          `export default defineConfig({\n  directories: { ${Object.entries(directories)
            .map(([key, value]) => `${key}: '${value}'`)
            .join(', ')} },`
        )
      )
      const options = ['--banner', '--form-controller', '--control-routes']
      assert.equal(await runConfigure(host, options, directories), 0)
      const files = [
        'settings/masquerade.ts',
        'bootstrap/providers/masquerade_native_provider.ts',
        'domain/services/masquerade_user_provider.ts',
        'domain/middleware/share_masquerade_status_middleware.ts',
        'domain/controllers/masquerade_form_controller.ts',
        'templates/components/masquerade/banner.edge',
        'bootstrap/masquerade_form_routes.ts',
        'bootstrap/masquerade_limiter.ts',
      ]
      for (const file of files) assert.isTrue(existsSync(join(host, file)), file)
      const kernelPath = join(host, 'bootstrap/kernel.ts')
      const kernel = await readFile(kernelPath, 'utf8')
      assert.include(kernel, "() => import('#middleware/share_masquerade_status_middleware')")
      const saved = await Promise.all(files.map((file) => readFile(join(host, file), 'utf8')))
      const migrationRoot = join(host, 'schema')
      const migrations = await readdir(migrationRoot)
      migrations.sort()
      assert.lengthOf(migrations, 2)
      assert.match(migrations[0], /^\d{13}_create_masquerade_modes\.ts$/)
      assert.match(migrations[1], /^\d{13}_create_masquerade_events\.ts$/)
      const migrationSources = await Promise.all(
        migrations.map(async (file) => {
          const source =
            '// Application-owned migration edit\n' +
            (await readFile(join(migrationRoot, file), 'utf8'))
          await writeFile(join(migrationRoot, file), source)
          return source
        })
      )
      assert.equal(await runConfigure(host, options, directories), 1)
      assert.deepEqual(
        await Promise.all(files.map((file) => readFile(join(host, file), 'utf8'))),
        saved
      )
      assert.equal(await runConfigure(host, [...options, '--force'], directories), 0)
      assert.equal(await readFile(kernelPath, 'utf8'), kernel)
      assert.sameMembers(await readdir(migrationRoot), migrations)
      assert.deepEqual(
        await Promise.all(migrations.map((file) => readFile(join(migrationRoot, file), 'utf8'))),
        migrationSources
      )
      assert.isFalse(existsSync(join(host, 'config/masquerade.ts')))
      assert.equal(await readFile(join(host, 'settings/auth.ts'), 'utf8'), starterAuthConfig)
      assert.deepEqual(await bootGeneratedRuntime(host, directories), {
        booted: true,
        guard: 'web_effective',
      })
    } finally {
      process.exitCode = previousProcessExitCode
      await rm(host, { recursive: true, force: true })
    }
  })
    .timeout(30_000)
    .skip(process.env.TEST_BUILT_EXPORTS !== '1', 'requires the built package')
})

async function starterHost(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'masquerade-starter-configure-'))
  for (const directory of ['config', 'start', 'app/models', 'node_modules/@kevinjohn'])
    await mkdir(join(root, directory), { recursive: true })
  await writeFile(join(root, 'app/models/user.ts'), 'export default class User {}\n')
  await writeFile(join(root, 'config/auth.ts'), starterAuthConfig)
  await writeFile(join(root, 'config/limiter.ts'), 'export default {}\n')
  await writeFile(join(root, 'start/kernel.ts'), starterKernel)
  await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n')
  await writeFile(
    join(root, 'adonisrc.ts'),
    `import { defineConfig } from '@adonisjs/core/app'
export default defineConfig({
  providers: [() => import('#providers/host_provider')],
  preloads: [() => import('#start/routes'), () => import('#start/kernel')],
})\n`
  )
  await symlink(
    join(process.cwd(), 'node_modules/@adonisjs'),
    join(root, 'node_modules/@adonisjs'),
    'dir'
  )
  await symlink(process.cwd(), join(root, 'node_modules/@kevinjohn/adonisjs-masquerade'), 'dir')
  return root
}

/** Boot the actual generated config and native provider against real Auth and Lucid.
 * The starter syntax fixture does not install the unrelated Shield/limiter/Vite providers.
 */
async function bootGeneratedRuntime(
  root: string,
  custom: Record<string, string> = {},
  verifyContainerService = false
) {
  const directories = {
    config: 'config',
    services: 'app/services',
    models: 'app/models',
    middleware: 'app/middleware',
    providers: 'providers',
    ...custom,
  }
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      type: 'module',
      imports: Object.fromEntries(
        Object.entries(directories).map(([key, directory]) => [`#${key}/*`, `./${directory}/*.js`])
      ),
    })
  )
  await writeFile(
    join(root, directories.providers, 'host_provider.ts'),
    'export default class HostProvider {}\n'
  )
  // Apply the documented host guard setup before booting.
  await writeFile(
    join(root, directories.config, 'auth.ts'),
    `
import { defineConfig } from '@adonisjs/auth'
import { sessionGuard } from '@adonisjs/auth/session'
import { effectiveSessionGuard } from '@kevinjohn/adonisjs-masquerade/auth'
import { userProvider } from '#services/masquerade_user_provider'

const raw = sessionGuard({ provider: userProvider, useRememberMeTokens: false })
export default defineConfig({
  default: 'web_effective',
  guards: { web: raw, web_effective: effectiveSessionGuard(raw) },
})
`
  )
  const auth = await import(pathToFileURL(join(root, directories.config, 'auth.ts')).href)
  const masquerade = await import(
    pathToFileURL(join(root, directories.config, 'masquerade.ts')).href
  )
  const rc = await import(pathToFileURL(join(root, 'adonisrc.ts')).href)
  const app = new IgnitorFactory()
    .withCoreConfig()
    .withCoreProviders()
    .merge({
      config: {
        auth: auth.default,
        masquerade: masquerade.default,
        database: {
          connection: 'sqlite',
          connections: {
            sqlite: {
              client: 'better-sqlite3',
              connection: { filename: ':memory:' },
              useNullAsDefault: true,
            },
          },
        },
      },
      rcFileContents: {
        directories,
        providers: [
          () => import('@adonisjs/auth/auth_provider'),
          () => import('@adonisjs/lucid/database_provider'),
          ...rc.default.providers,
        ],
      },
    })
    .create(pathToFileURL(root + '/'))
    .createApp('web')
  try {
    await app.init()
    await app.boot()
    const runtime = await app.container.make('masquerade.runtime')
    if (verifyContainerService) {
      const servicePath = '@kevinjohn/adonisjs-masquerade/services/main'
      const { default: service } = await import(servicePath)
      if (service !== runtime)
        throw new Error('The container service did not resolve the booted singleton')
    }
    return { booted: app.isBooted, guard: runtime.effectiveGuardName }
  } finally {
    await app.terminate()
  }
}

async function runConfigure(
  root: string,
  flags: string[] = [],
  directories: Record<string, string> = {}
): Promise<number | undefined> {
  process.exitCode = 0
  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({ rcFileContents: { commands: [configureCommandLoader], directories } })
    .create(pathToFileURL(root + '/'))
  await ignitor
    .ace()
    .configure(async (app) => {
      app.import = async (specifier: string) => {
        if (specifier === '@kevinjohn/adonisjs-masquerade')
          return import('@kevinjohn/adonisjs-masquerade')
        if (specifier === '@adonisjs/lucid') return import('@adonisjs/lucid')
        if (specifier === '@adonisjs/assembler/code_transformer')
          return import('@adonisjs/assembler/code_transformer')
        throw new Error('Unexpected package import: ' + specifier)
      }
    })
    .handle([
      'configure',
      '@kevinjohn/adonisjs-masquerade',
      '--namespace=starter',
      '--guard=web',
      ...flags,
    ])
  return process.exitCode
}

async function configureCommandLoader() {
  const configureModule = await import('@adonisjs/core/commands/configure')
  const ConfigureCommand = configureModule.default
  return {
    async getMetaData() {
      return [ConfigureCommand.serialize()]
    },
    async getCommand(metaData: ReturnType<typeof ConfigureCommand.serialize>) {
      return metaData.commandName === ConfigureCommand.commandName ? ConfigureCommand : null
    },
  }
}
