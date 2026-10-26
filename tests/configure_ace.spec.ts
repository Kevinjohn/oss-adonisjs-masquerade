import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { starterAuthConfig, starterKernel } from './helpers/starter_kit.js'

test.group('Masquerade configure scaffold', () => {
  test('loads and executes the package hook through native Ace', async ({ assert }) => {
    const root = await mkdtemp(join(tmpdir(), 'masquerade-ace-configure-'))
    const previousProcessExitCode = process.exitCode
    try {
      await mkdir(join(root, 'config'), { recursive: true })
      await mkdir(join(root, 'start'), { recursive: true })
      await mkdir(join(root, 'node_modules'), { recursive: true })
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
      await symlink(process.cwd(), join(root, 'node_modules/adonisjs-masquerade'), 'dir')

      const ignitor = new IgnitorFactory()
        .withCoreProviders()
        .withCoreConfig()
        .merge({ rcFileContents: { commands: [configureCommandLoader] } })
        .create(pathToFileURL(root + '/'))
      await ignitor
        .ace()
        .configure(async (app) => {
          app.import = async (specifier: string) => {
            if (specifier === 'adonisjs-masquerade') return import('adonisjs-masquerade')
            if (specifier === '@adonisjs/lucid') return import('@adonisjs/lucid')
            if (specifier === '@adonisjs/assembler/code_transformer')
              return import('@adonisjs/assembler/code_transformer')
            throw new Error('Unexpected package import: ' + specifier)
          }
        })
        .handle(['configure', 'adonisjs-masquerade', '--namespace=ace_app', '--guard=web'])
      assert.equal(process.exitCode, 0)
      process.exitCode = previousProcessExitCode

      await ignitor
        .ace()
        .configure(async (app) => {
          app.import = async (specifier: string) => {
            if (specifier === 'adonisjs-masquerade') return import('adonisjs-masquerade')
            if (specifier === '@adonisjs/lucid') return import('@adonisjs/lucid')
            if (specifier === '@adonisjs/assembler/code_transformer')
              return import('@adonisjs/assembler/code_transformer')
            throw new Error('Unexpected package import: ' + specifier)
          }
        })
        .handle([
          'configure',
          'adonisjs-masquerade',
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
      const migrations = await readdir(join(root, 'database/migrations'))
      assert.equal(migrations.length, 1)
      const rcFile = await readFile(join(root, 'adonisrc.ts'), 'utf8')
      assert.include(rcFile, "'#providers/host_provider'")
      assert.include(rcFile, "'#commands/host_command'")
      assert.isBelow(
        rcFile.indexOf('#providers/masquerade_native_provider'),
        rcFile.indexOf('adonisjs-masquerade/providers/masquerade_provider')
      )
      assert.equal(rcFile.match(/adonisjs-masquerade\/providers\/masquerade_provider/g)?.length, 1)
      assert.equal(rcFile.match(/adonisjs-masquerade\/commands/g)?.length, 1)
      assert.include(rcFile, '#providers/masquerade_native_provider')

      const middlewareModule = await import(
        pathToFileURL(join(root, 'app/middleware/masquerade_context_middleware.ts')).href
      )
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
      assert.isTrue(
        continued,
        'generated middleware class should load and invoke the package handler'
      )
    } finally {
      process.exitCode = previousProcessExitCode
      await rm(root, { recursive: true, force: true })
    }
  })
    .timeout(10_000)
    // The generated app imports the compiled package; `pnpm test:built-exports` runs this after build.
    .skip(process.env.TEST_BUILT_EXPORTS !== '1', 'requires the built package')

  test('wires a starter-kit host, and --no-wire leaves it to the printed steps', async ({
    assert,
  }) => {
    const previousProcessExitCode = process.exitCode
    const wired = await starterHost()
    const manual = await starterHost()
    const json = await starterHost()
    try {
      assert.equal(await runConfigure(wired, ['--banner', '--form-controller']), 0)
      assert.equal(await runConfigure(json, ['--banner']), 0)
      const auth = await readFile(join(wired, 'config/auth.ts'), 'utf8')
      assert.include(auth, "default: 'web_effective',")
      assert.include(auth, 'web_effective: effectiveSessionGuard(webGuard),')
      assert.include(
        await readFile(join(wired, 'start/kernel.ts'), 'utf8'),
        "initialize_auth_middleware'),\n  () => import('#middleware/masquerade_context_middleware'),"
      )
      assert.include(
        await readFile(join(wired, 'start/kernel.ts'), 'utf8'),
        "() => import('#middleware/silent_auth_middleware'),\n  () => import('#middleware/share_masquerade_status_middleware'),"
      )
      assert.include(
        await readFile(join(wired, 'app/middleware/share_masquerade_status_middleware.ts'), 'utf8'),
        'runtime.selectGuard(ctx).kind'
      )
      assert.include(
        await readFile(join(wired, 'resources/views/components/masquerade/banner.edge'), 'utf8'),
        'masquerade.contextToken'
      )
      assert.include(
        await readFile(join(wired, 'resources/views/components/masquerade/banner.edge'), 'utf8'),
        '@if(masquerade && masquerade.isMasquerading)'
      )
      assert.include(
        await readFile(join(wired, 'app/controllers/masquerade_form_controller.ts'), 'utf8'),
        'function acceptsHtmlForm(ctx: HttpContext): boolean'
      )
      const routes = await readFile(join(wired, 'start/masquerade_routes.ts'), 'utf8')
      assert.include(routes, "guards: ['web']")
      assert.include(
        routes,
        "import MasqueradeFormController from '#controllers/masquerade_form_controller'"
      )
      assert.include(routes, "[MasqueradeFormController, 'stop']")
      assert.include(routes, "[MasqueradeController, 'status']")
      const jsonRoutes = await readFile(join(json, 'start/masquerade_routes.ts'), 'utf8')
      assert.include(jsonRoutes, "import { masqueradeRoutes } from 'adonisjs-masquerade/http'")
      assert.notInclude(jsonRoutes, 'MasqueradeFormController')
      assert.isFalse(existsSync(join(json, 'app/controllers/masquerade_form_controller.ts')))
      assert.include(
        await readFile(join(wired, 'start/masquerade_limiter.ts'), 'utf8'),
        "ctx.auth.use('web').getUserOrFail()"
      )
      assert.include(
        await readFile(join(wired, 'adonisrc.ts'), 'utf8'),
        "() => import('#start/masquerade_routes')"
      )

      assert.equal(await runConfigure(manual, ['--no-wire']), 0)
      assert.equal(await readFile(join(manual, 'config/auth.ts'), 'utf8'), starterAuthConfig)
      assert.equal(await readFile(join(manual, 'start/kernel.ts'), 'utf8'), starterKernel)
      assert.isFalse(existsSync(join(manual, 'start/masquerade_routes.ts')))
      assert.isFalse(existsSync(join(manual, 'start/masquerade_limiter.ts')))
      assert.notInclude(await readFile(join(manual, 'adonisrc.ts'), 'utf8'), 'masquerade_routes')
    } finally {
      process.exitCode = previousProcessExitCode
      await rm(wired, { recursive: true, force: true })
      await rm(manual, { recursive: true, force: true })
      await rm(json, { recursive: true, force: true })
    }
  })
    .timeout(20_000)
    .skip(process.env.TEST_BUILT_EXPORTS !== '1', 'requires the built package')
})

async function starterHost(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'masquerade-starter-configure-'))
  for (const directory of ['config', 'start', 'node_modules'])
    await mkdir(join(root, directory), { recursive: true })
  await writeFile(join(root, 'config/auth.ts'), starterAuthConfig)
  await writeFile(join(root, 'config/limiter.ts'), 'export default {}\n')
  await writeFile(join(root, 'start/kernel.ts'), starterKernel)
  await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n')
  await writeFile(
    join(root, 'adonisrc.ts'),
    `import { defineConfig } from '@adonisjs/core'
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
  await symlink(process.cwd(), join(root, 'node_modules/adonisjs-masquerade'), 'dir')
  return root
}

async function runConfigure(root: string, flags: string[] = []): Promise<number | undefined> {
  process.exitCode = 0
  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({ rcFileContents: { commands: [configureCommandLoader] } })
    .create(pathToFileURL(root + '/'))
  await ignitor
    .ace()
    .configure(async (app) => {
      app.import = async (specifier: string) => {
        if (specifier === 'adonisjs-masquerade') return import('adonisjs-masquerade')
        if (specifier === '@adonisjs/lucid') return import('@adonisjs/lucid')
        if (specifier === '@adonisjs/assembler/code_transformer')
          return import('@adonisjs/assembler/code_transformer')
        throw new Error('Unexpected package import: ' + specifier)
      }
    })
    .handle(['configure', 'adonisjs-masquerade', '--namespace=starter', '--guard=web', ...flags])
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
