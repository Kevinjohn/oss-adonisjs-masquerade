import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stubsRoot } from '../stubs/main.js'
import { configure } from '../configure.js'
import { pathToFileURL } from 'node:url'

test.group('Masquerade configure scaffold', (group) => {
  // configure now wires the host through a ts-morph project, which is slow on CI runners.
  group.each.timeout(30_000)

  test('generates fail-closed files and additive wiring, skips existing files, and force replaces them', async ({
    assert,
  }) => {
    const f = await configureFixture()
    try {
      const first = f.command({ namespace: 'support', guard: 'web' })
      await configure(first as never)
      const output = await readScaffold(f.root)
      assert.include(output.config, 'namespace: "support"')
      assert.include(output.config, 'guard: "web"')
      assert.include(output.config, "contextEnforcement: 'report'")
      assert.include(output.config, "retention: 'host-managed'")
      assert.include(output.config, 'return false')
      assert.include(
        output.config,
        "import { userProvider } from '#services/masquerade_user_provider'"
      )
      assert.isFalse(output.config.includes("incarnation: 'id'"))
      assert.isFalse(output.config.includes('isActive: () => true'))
      assert.include(
        output.config,
        'Configure immutable account incarnation and security stamp callbacks'
      )
      assert.include(output.config, 'securityStamp: stampFrom<User>')
      assert.include(output.userProvider, "model: () => import('#models/user')")
      assert.include(output.nativeProvider, "bindValue('masquerade.native', nativeAdapter)")
      assert.include(output.middleware, 'export default class MasqueradeContextMiddleware')
      assert.include(output.middleware, 'return masqueradeContext(ctx, next)')
      assert.isUndefined(output.banner)
      assert.isUndefined(output.statusMiddleware)
      const migrationStub = await readFile(
        join(stubsRoot, 'migrations/create_masquerade_tables.stub'),
        'utf8'
      )
      assert.match(migrationStub, /exports\(\{ to: app\.makePath/)
      assert.include(output.migration, 'createMasqueradeSchema(this.schema)')
      assert.include(output.migration, 'async up()')
      assert.include(output.migration, 'async down()')
      assert.deepEqual(f.registered, [
        '#providers/masquerade_native_provider',
        'adonisjs-masquerade/providers/masquerade_provider',
        'adonisjs-masquerade/commands',
      ])
      assert.isTrue(first.messages.some((message) => message.includes('effectiveSessionGuard')))
      assert.isTrue(
        first.messages.some((message) =>
          message.includes('masqueradeRoutes(router, { auth: middleware.auth, guard: "web"')
        )
      )
      assert.isTrue(first.messages.some((message) => message.includes('node ace migration:run')))
      assert.equal(await readFile(join(f.root, 'start/kernel.ts'), 'utf8'), 'host kernel')
      assert.equal(await readFile(join(f.root, 'start/routes.ts'), 'utf8'), 'host routes')

      const before = await snapshot(f.root)
      const second = f.command({ namespace: 'support', guard: 'web' })
      await configure(second as never)
      assert.equal(second.exitCode, 1)
      assert.isTrue(second.errors.some((message) => message.includes('--force')))
      assert.deepEqual(await snapshot(f.root), before)

      const pathsBeforeForce = await listScaffoldPaths(f.root)
      const migrationPathsBeforeForce = pathsBeforeForce.filter((path) =>
        path.startsWith('database/migrations/')
      )
      await writeFile(join(f.root, 'unrelated.txt'), 'untouched')
      await writeFile(join(f.root, 'config/masquerade.ts'), 'customized')
      const forced = f.command({ namespace: 'support', guard: 'web' }, true)
      await configure(forced as never)
      assert.include(
        await readFile(join(f.root, 'config/masquerade.ts'), 'utf8'),
        'namespace: "support"'
      )
      const pathsAfterForce = await listScaffoldPaths(f.root)
      assert.deepEqual(
        pathsAfterForce.filter((path) => path.startsWith('database/migrations/')),
        migrationPathsBeforeForce
      )
      assert.equal(await readFile(join(f.root, 'unrelated.txt'), 'utf8'), 'untouched')
    } finally {
      await f.dispose()
    }
  })

  test('generates the host-owned status sharing middleware and Edge banner only when requested', async ({
    assert,
  }) => {
    const f = await configureFixture()
    try {
      const configured = f.command({ namespace: 'support', guard: 'web', banner: true })
      await configure(configured as never)

      const output = await readScaffold(f.root)
      assert.include(output.banner!, 'You are viewing as account {{ masquerade.targetId }}.</p>')
      assert.include(
        output.banner!,
        "Access: {{ masquerade.access === 'edit' ? 'Can edit' : 'View only' }}.</p>"
      )
      assert.include(output.banner!, 'datetime="{{ masquerade.expiresAt }}">')
      assert.include(output.banner!, 'action="{{ route(\'masquerade.stop\') }}">')
      assert.include(output.banner!, '{{ csrfField() }}')
      assert.include(output.banner!, 'name="_masqueradeContext"')
      assert.include(output.banner!, 'masquerade.contextToken')
      assert.include(output.statusMiddleware!, 'runtime.selectGuard(ctx).kind')
      assert.include(output.statusMiddleware!, 'ctx.auth.check()')
      assert.include(output.statusMiddleware!, 'runtime.admit(ctx)')
      assert.notInclude(output.statusMiddleware!, 'runtime.service.status(ctx)')
      assert.include(output.statusMiddleware!, 'view?.share({ masquerade })')
      assert.include(output.statusMiddleware!, 'inertia?.share({ masquerade })')
      assert.notInclude(output.statusMiddleware!, 'ctx.auth.user')
      assert.notInclude(output.statusMiddleware!, 'fullName')
      assert.notInclude(output.statusMiddleware!, 'email')
      assert.isTrue(
        configured.messages.some((message) =>
          message.includes('Wire app/middleware/share_masquerade_status_middleware.ts')
        )
      )

      const module = await import(
        pathToFileURL(join(f.root, 'app/middleware/share_masquerade_status_middleware.ts')).href
      )
      const middleware = new module.default()
      const status = {
        isMasquerading: true,
        contextToken: '3.0123456789abcdef0123456789abcdef',
        targetId: 'customer-1',
        access: 'view',
        startedAt: '2026-10-25T10:00:00.000Z',
        expiresAt: '2026-10-25T10:15:00.000Z',
      }
      const newerStatus = {
        ...status,
        targetId: 'customer-2',
        contextToken: '4.0123456789abcdef0123456789abcdef',
      }
      let statusReads = 0
      const run = async (kind: string, authenticated: boolean, fail = false) => {
        const edge: unknown[] = []
        const inertia: unknown[] = []
        let continued = false
        let admissionCalled = false
        const runtime = {
          selectGuard: () => ({ kind }),
          async admit() {
            admissionCalled = true
            if (fail) throw new Error('store unavailable')
            return { view: status }
          },
          service: {
            async status() {
              statusReads++
              if (fail) throw new Error('store unavailable')
              // A second status read could see a concurrently updated row.
              return newerStatus
            },
          },
        }
        const ctx = {
          containerResolver: { make: async () => runtime },
          auth: { check: async () => authenticated },
          view: { share: (value: unknown) => edge.push(value) },
          inertia: { share: (value: unknown) => inertia.push(value) },
        }
        const result = middleware.handle(ctx as never, async () => {
          continued = true
        })
        let failure: unknown
        try {
          await result
        } catch (error) {
          failure = error
        }
        if (fail && admissionCalled) assert.equal((failure as Error)?.message, 'store unavailable')
        else if (failure) throw failure
        return { edge, inertia, continued, statusReads, admissionCalled }
      }

      await run('none', false, true)
      await run('raw', false, true)
      const anonymous = await run('effective', false)
      assert.equal(statusReads, 0)
      assert.deepEqual(anonymous.edge, [])
      assert.deepEqual(anonymous.inertia, [])
      const anonymousDuringOutage = await run('effective', false, true)
      assert.equal(anonymousDuringOutage.statusReads, 0)
      assert.isTrue(anonymousDuringOutage.continued)
      const authenticated = await run('effective', true)
      assert.equal(statusReads, 0)
      assert.isTrue(authenticated.admissionCalled)
      assert.deepEqual(authenticated.edge, [{ masquerade: status }])
      assert.deepEqual(authenticated.inertia, [{ masquerade: status }])
      assert.isTrue(authenticated.continued)
      const authenticatedDuringOutage = await run('effective', true, true)
      assert.equal(statusReads, 0)
      assert.isTrue(authenticatedDuringOutage.admissionCalled)
      assert.deepEqual(authenticatedDuringOutage.edge, [])
    } finally {
      await f.dispose()
    }
  })

  test('prompts for missing values and rejects unsafe namespace before touching files', async ({
    assert,
  }) => {
    const f = await configureFixture()
    try {
      const prompted = f.command({}, false, ['test_app', 'support-web'])
      await configure(prompted as never)
      assert.deepEqual(prompted.prompts, ['Masquerade namespace', 'Raw session guard name'])
      const promptedOutput = await readScaffold(f.root)
      assert.include(promptedOutput.config, 'namespace: "test_app"')
      assert.isTrue(
        prompted.messages.some((message) =>
          message.includes('default: "support-web_effective"; guards: { "support-web": rawGuard')
        )
      )

      const before = await snapshot(f.root)
      const invalid = f.command({ namespace: '../unsafe', guard: 'web' })
      await configure(invalid as never)
      assert.equal(invalid.exitCode, 1)
      assert.isTrue(invalid.errors.some((message) => message.includes('Invalid namespace')))
      assert.deepEqual(await snapshot(f.root), before)
    } finally {
      await f.dispose()
    }
  })

  test('fails closed when Auth config or Lucid is unavailable', async ({ assert }) => {
    const f = await configureFixture()
    try {
      await rm(join(f.root, 'config/auth.ts'))
      const missingAuth = f.command({ namespace: 'support', guard: 'web' })
      await configure(missingAuth as never)
      assert.equal(missingAuth.exitCode, 1)
      assert.isTrue(
        missingAuth.errors.some((message) => message.includes('Configure @adonisjs/auth'))
      )

      await writeFile(join(f.root, 'config/auth.ts'), 'export default {}')
      const missingAssembler = f.command({ namespace: 'support', guard: 'web' })
      missingAssembler.app.import = async (specifier: string) => {
        if (specifier === '@adonisjs/assembler/code_transformer')
          throw Object.assign(new Error('missing assembler'), { code: 'ERR_MODULE_NOT_FOUND' })
        return {}
      }
      await configure(missingAssembler as never)
      assert.equal(missingAssembler.exitCode, 1)
      assert.isTrue(
        missingAssembler.errors.some((message) =>
          message.includes('pnpm add -D @adonisjs/assembler')
        )
      )
      assert.deepEqual(await listScaffoldPaths(f.root), [])

      const missingLucid = f.command({ namespace: 'support', guard: 'web' })
      missingLucid.app.import = async (specifier: string) => {
        if (specifier === '@adonisjs/assembler/code_transformer')
          return import('@adonisjs/assembler/code_transformer')
        throw Object.assign(new Error(`missing ${specifier}`), { code: 'ERR_MODULE_NOT_FOUND' })
      }
      await configure(missingLucid as never)
      assert.equal(missingLucid.exitCode, 1)
      assert.isTrue(
        missingLucid.errors.some((message) => message.includes('pnpm add @adonisjs/lucid'))
      )
      assert.deepEqual(await listScaffoldPaths(f.root), [])
    } finally {
      await f.dispose()
    }
  })

  test('returns failure when native registration reports a codemod error', async ({ assert }) => {
    const f = await configureFixture()
    try {
      const failing = f.command({ namespace: 'support', guard: 'web' }, false, [], true)
      await configure(failing as never)
      assert.equal(failing.exitCode, 1)
      assert.isTrue(failing.errors.some((message) => message.includes('registration failed')))
    } finally {
      await f.dispose()
    }
  })
})

async function configureFixture() {
  const root = await mkdtemp(join(tmpdir(), 'masquerade-configure-'))
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'start'), { recursive: true })
  await writeFile(join(root, 'config/auth.ts'), 'export default {}')
  await writeFile(join(root, 'start/kernel.ts'), 'host kernel')
  await writeFile(join(root, 'start/routes.ts'), 'host routes')
  await symlink(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir')
  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .create(pathToFileURL(root + '/'))
  const app = ignitor.createApp('web')
  await app.init()
  await app.boot()
  app.import = async (specifier) => {
    if (specifier === '@adonisjs/lucid') return {}
    if (specifier === '@adonisjs/assembler/code_transformer')
      return import('@adonisjs/assembler/code_transformer')
    throw new Error(`Unexpected application import: ${specifier}`)
  }
  const registered: string[] = []
  function command(
    parsedFlags: Record<string, unknown>,
    force = false,
    answers: string[] = [],
    failRegistration = false
  ) {
    const messages: string[] = []
    const errors: string[] = []
    const prompts: string[] = []
    let answer = 0
    let onError: ((error: unknown) => void) | undefined
    const codemods = {
      overwriteExisting: false,
      on(_event: string, callback: (error: unknown) => void) {
        onError = callback
      },
      async makeUsingStub(stubRoot: string, stubPath: string, state: Record<string, unknown>) {
        const stubGenerator = await app.stubs.create()
        const stub = await stubGenerator.build(stubPath, { source: stubRoot })
        return stub.generate({ ...state, force: codemods.overwriteExisting })
      },
      async updateRcFile(
        callback: (rcFile: {
          addProvider(value: string): unknown
          addCommand(value: string): unknown
        }) => void
      ) {
        callback({
          addProvider(value) {
            if (!registered.includes(value)) registered.push(value)
          },
          addCommand(value) {
            if (!registered.includes(value)) registered.push(value)
          },
        })
        if (failRegistration) onError?.(new Error('fixture registration failure'))
      },
    }
    const configCommand = {
      app,
      parsedFlags,
      prompt: {
        async ask(question: string) {
          prompts.push(question)
          return answers[answer++]!
        },
      },
      logger: {
        info(message: string) {
          messages.push(message)
        },
        error(message: string) {
          errors.push(message)
        },
      },
      exitCode: 0,
      force,
      stubsRoot,
      async createCodemods() {
        return codemods
      },
      messages,
      errors,
      prompts,
    }
    return configCommand
  }
  return {
    root,
    command,
    registered,
    async dispose() {
      await app.terminate()
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function listScaffoldPaths(root: string): Promise<string[]> {
  const files = [
    'app/services/masquerade_user_provider.ts',
    'config/masquerade.ts',
    'providers/masquerade_native_provider.ts',
    'app/middleware/masquerade_context_middleware.ts',
    'app/middleware/share_masquerade_status_middleware.ts',
    'resources/views/components/masquerade/banner.edge',
  ]
  const paths: string[] = []
  for (const file of files) {
    try {
      await readFile(join(root, file))
      paths.push(file)
    } catch {
      // An empty result proves fail-closed preflight created nothing.
    }
  }
  const migrations = await readdir(join(root, 'database/migrations')).catch(() => [])
  paths.push(...migrations.map((file) => 'database/migrations/' + file))
  return paths
}

async function readScaffold(root: string) {
  const paths = await listScaffoldPaths(root)
  const read = async (file: string) => readFile(join(root, file), 'utf8')
  const migrationPath = paths.find((path) => path.startsWith('database/migrations/'))
  if (!migrationPath) throw new Error('Configure did not generate the migration')
  return {
    config: await read('config/masquerade.ts'),
    userProvider: await read('app/services/masquerade_user_provider.ts'),
    nativeProvider: await read('providers/masquerade_native_provider.ts'),
    middleware: await read('app/middleware/masquerade_context_middleware.ts'),
    statusMiddleware: await optionalRead('app/middleware/share_masquerade_status_middleware.ts'),
    banner: await optionalRead('resources/views/components/masquerade/banner.edge'),
    migration: await read(migrationPath),
  }

  async function optionalRead(file: string): Promise<string | undefined> {
    try {
      return await read(file)
    } catch {
      return undefined
    }
  }
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const paths = await listScaffoldPaths(root)
  return Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), 'utf8')]))
  )
}
