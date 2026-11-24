// The configure hook's scaffold: generated files, optional stubs, prompts and fail-closed exits.
// Config and kernel rewrites go to configure_wiring.spec.ts, Ace runs to configure_ace.spec.ts.
// Fixtures: configureFixture() and readScaffold() at the end of this file.
import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stubsRoot } from '../stubs/main.js'
import { configure } from '../configure.js'
import { pathToFileURL } from 'node:url'
import { Database } from '@adonisjs/lucid/database'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { Emitter } from '@adonisjs/core/events'
import { Logger } from '@adonisjs/core/logger'
import { sqlFixture } from './helpers/sql_store.js'

test.group('Masquerade configure scaffold', (group) => {
  // configure now wires the host through a ts-morph project, which is slow on CI runners.
  group.each.timeout(30_000)

  test('scaffold inspection rethrows filesystem errors other than missing paths', async ({
    assert,
  }) => {
    const readFailureRoot = await mkdtemp(join(tmpdir(), 'masquerade-configure-read-failure-'))
    try {
      const path = join(readFailureRoot, 'app/services/masquerade_user_provider.ts')
      await mkdir(path, { recursive: true })
      let readError: unknown
      try {
        await listScaffoldPaths(readFailureRoot)
      } catch (error) {
        readError = error
      }
      assert.equal((readError as NodeJS.ErrnoException | undefined)?.code, 'EISDIR')
    } finally {
      await rm(readFailureRoot, { recursive: true, force: true })
    }

    const readdirFailureRoot = await mkdtemp(join(tmpdir(), 'masquerade-configure-list-failure-'))
    try {
      await mkdir(join(readdirFailureRoot, 'database'), { recursive: true })
      await writeFile(join(readdirFailureRoot, 'database/migrations'), 'not a directory')
      let readdirError: unknown
      try {
        await listScaffoldPaths(readdirFailureRoot)
      } catch (error) {
        readdirError = error
      }
      assert.equal((readdirError as NodeJS.ErrnoException | undefined)?.code, 'ENOTDIR')
    } finally {
      await rm(readdirFailureRoot, { recursive: true, force: true })
    }
  })

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
      assert.notInclude(
        await listScaffoldPaths(f.root),
        'app/middleware/masquerade_context_middleware.ts'
      )
      assert.isTrue(
        first.messages.some((message) =>
          message.includes(
            "Register () => import('@kevinjohn/adonisjs-masquerade/masquerade_context_middleware') as router middleware"
          )
        )
      )
      assert.isUndefined(output.banner)
      assert.isUndefined(output.statusMiddleware)
      assert.isUndefined(output.formController)
      assert.include(output.migration, 'createMasqueradeSchemaV1(this.schema)')
      assert.include(output.migration, 'async up()')
      assert.include(output.migration, 'async down()')
      assert.deepEqual(f.registered, [
        '#providers/masquerade_native_provider',
        '@kevinjohn/adonisjs-masquerade/masquerade_provider',
        '@kevinjohn/adonisjs-masquerade/commands',
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

  test('generates the host-owned form controller only when requested', async ({ assert }) => {
    const f = await configureFixture()
    try {
      const configured = f.command({ namespace: 'support', guard: 'web', formController: true })
      await configure(configured as never)

      const output = await readScaffold(f.root)
      assert.include(output.formController!, 'class MasqueradeFormController')
      assert.include(output.formController!, 'function acceptsHtmlForm(ctx: HttpContext): boolean')
      assert.include(output.formController!, 'ctx.session.flash({ masquerade: message })')
      assert.include(output.formController!, 'MasqueradeResponseCode')
      assert.include(output.formController!, 'await this.formTransition(ctx, action)')
      assert.include(output.formController!, "return '/'")
      assert.isTrue(
        configured.messages.some((message) =>
          message.includes('Edit app/controllers/masquerade_form_controller.ts')
        )
      )
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

  test('names the generated route files among the paths --force would replace', async ({
    assert,
  }) => {
    const f = await configureFixture()
    try {
      await writeFile(join(f.root, 'start/masquerade_limiter.ts'), 'tuned limiter')
      const refused = f.command({ namespace: 'support', guard: 'web' })
      await configure(refused as never)
      assert.equal(refused.exitCode, 1)
      assert.isTrue(
        refused.errors.some((message) => message.includes('start/masquerade_limiter.ts'))
      )
      assert.deepEqual(await listScaffoldPaths(f.root), [])
      // --no-wire never writes the route files, so they are not conflicts.
      const manual = f.command({ namespace: 'support', guard: 'web', wire: false })
      await configure(manual as never)
      assert.equal(manual.exitCode, 0)
      assert.equal(
        await readFile(join(f.root, 'start/masquerade_limiter.ts'), 'utf8'),
        'tuned limiter'
      )
    } finally {
      await f.dispose()
    }
  })

  test('fails when a codemod reports an error during host wiring', async ({ assert }) => {
    const f = await configureFixture()
    try {
      const configured = f.command({ namespace: 'support', guard: 'web' })
      const create = configured.createCodemods
      configured.createCodemods = async () => {
        const codemods = await create()
        let raise: ((error: unknown) => void) | undefined
        const on = codemods.on.bind(codemods)
        return Object.assign(codemods, {
          on(event: string, callback: (error: unknown) => void) {
            raise = callback
            on(event, callback)
          },
          // Wiring starts by asking for the project; a codemod error raised from here on is late.
          async getTsMorphProject() {
            raise?.(new Error('preload registration failed'))
            return undefined
          },
        })
      }
      await configure(configured as never)
      assert.equal(configured.exitCode, 1)
      assert.isTrue(configured.errors.some((message) => message.includes('Host wiring failed')))
    } finally {
      await f.dispose()
    }
  })

  test('reads a numeric namespace as it was typed', async ({ assert }) => {
    const f = await configureFixture()
    const argv = process.argv
    process.argv = [...argv, '--namespace=0042']
    try {
      // Ace's parser turns --namespace=0042 into the number 42.
      const configured = f.command({ namespace: 42, guard: 'web' })
      await configure(configured as never)
      assert.equal(configured.exitCode, 0)
      assert.include(await readFile(join(f.root, 'config/masquerade.ts'), 'utf8'), '"0042"')
    } finally {
      process.argv = argv
      await f.dispose()
    }
  })

  test('refuses before writing when the user model the scaffold imports is missing', async ({
    assert,
  }) => {
    const f = await configureFixture()
    try {
      await rm(join(f.root, 'app/models/user.ts'))
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await configure(configured as never)
      assert.equal(configured.exitCode, 1)
      assert.isTrue(configured.errors.some((message) => message.includes('#models/user')))
      assert.deepEqual(await listScaffoldPaths(f.root), [])
    } finally {
      await f.dispose()
    }
  })

  test('finds the user model through the host #models import map', async ({ assert }) => {
    const f = await configureFixture()
    try {
      await rm(join(f.root, 'app/models/user.ts'))
      await mkdir(join(f.root, 'src/models'), { recursive: true })
      await writeFile(join(f.root, 'src/models/user.ts'), 'export default class User {}')
      await writeFile(
        join(f.root, 'package.json'),
        JSON.stringify({ imports: { '#models/*': './src/models/*.js' } })
      )
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await configure(configured as never)
      assert.equal(configured.exitCode, 0, configured.errors.join('\n'))
    } finally {
      await f.dispose()
    }
  })

  test('writes the migration into the Lucid connection migrations folder', async ({ assert }) => {
    const f = await configureFixture()
    try {
      f.app.config.set('database', {
        connection: 'main',
        connections: { main: { migrations: { paths: ['./db/schema/'] } } },
      })
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await configure(configured as never)
      assert.equal(configured.exitCode, 0)
      const files = await readdir(join(f.root, 'db/schema'))
      assert.lengthOf(
        files.filter((file) => file.endsWith('_create_masquerade_tables.ts')),
        1
      )
    } finally {
      await f.dispose()
    }
  })

  test('reports a migration path that is not a directory without writing files', async ({
    assert,
  }) => {
    const f = await configureFixture()
    try {
      await writeFile(join(f.root, 'schema.txt'), 'not a directory')
      f.app.config.set('database', {
        connection: 'main',
        connections: { main: { migrations: { paths: ['schema.txt'] } } },
      })
      const before = await snapshot(f.root)
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await configure(configured as never)
      assert.equal(configured.exitCode, 1)
      assert.deepEqual(configured.errors, [
        'Expected a migration directory at schema.txt. Point the default connection migrations.paths at directories and rerun configure.',
      ])
      assert.deepEqual(await snapshot(f.root), before)
      assert.deepEqual(f.registered, [])
    } finally {
      await f.dispose()
    }
  })

  test('reports a migration destination occupied by an entry that Lucid ignores', async ({
    assert,
  }) => {
    const f = await configureFixture()
    const now = Date.now
    Date.now = () => 1_700_000_000_000
    try {
      const occupied = 'database/migrations/1700000000000_create_masquerade_tables.ts'
      await mkdir(join(f.root, occupied), { recursive: true })
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await configure(configured as never)
      assert.equal(configured.exitCode, 1)
      assert.deepEqual(configured.errors, [
        `The migration destination ${occupied} is occupied by an entry that Lucid ignores. Move it out of the migration directory and rerun configure.`,
      ])
      assert.deepEqual(await listScaffoldPaths(f.root), [occupied])
      assert.deepEqual(f.registered, [])
    } finally {
      Date.now = now
      await f.dispose()
    }
  })

  test('stops before writing when config/database.ts exists but fails to load', async ({
    assert,
  }) => {
    const f = await configureFixture()
    const load = f.app.import
    try {
      await mkdir(join(f.root, 'config'), { recursive: true })
      await writeFile(join(f.root, 'config/database.ts'), 'export default {}\n')
      f.app.import = async (specifier: string) => {
        if (specifier === f.app.makeURL('config/database.ts').href)
          throw new Error('database config exploded')
        return load(specifier)
      }
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await assert.rejects(() => configure(configured as never), 'database config exploded')
      assert.deepEqual(await listScaffoldPaths(f.root), [])
    } finally {
      f.app.import = load
      await f.dispose()
    }
  })

  test('stops before writing when package.json is not JSON', async ({ assert }) => {
    const f = await configureFixture()
    try {
      await writeFile(join(f.root, 'package.json'), '{"imports":')
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await assert.rejects(() => configure(configured as never), /JSON/)
      assert.deepEqual(await listScaffoldPaths(f.root), [])
    } finally {
      await f.dispose()
    }
  })

  test('falls back to database/migrations without config/database.ts or package.json', async ({
    assert,
  }) => {
    const f = await configureFixture()
    try {
      await rm(join(f.root, 'config/database.ts'), { force: true })
      await rm(join(f.root, 'package.json'), { force: true })
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await configure(configured as never)
      assert.equal(configured.exitCode, 0, configured.errors.join('\n'))
      const files = await readdir(join(f.root, 'database/migrations'))
      assert.lengthOf(
        files.filter((file) => file.endsWith('_create_masquerade_tables.ts')),
        1
      )
    } finally {
      await f.dispose()
    }
  })

  test('uses the same absolute RC migration fallback as Lucid', async ({ assert }) => {
    const f = await configureFixture()
    const directory = join(f.root, 'schema')
    f.app.rcFile.directories.migrations = directory
    const db = new Database(
      {
        connection: 'primary',
        connections: {
          primary: {
            client: 'better-sqlite3',
            connection: { filename: join(f.root, 'db.sqlite3') },
            useNullAsDefault: true,
          },
        },
      },
      new Logger({ name: 'configure', enabled: false }),
      new Emitter(f.app)
    )
    try {
      const configured = f.command({ 'namespace': 'support', 'guard': 'web', 'no-wire': true })
      await configure(configured as never)
      assert.equal(configured.exitCode, 0, configured.errors.join('\n'))
      const runner = new MigrationRunner(db, f.app, { direction: 'up', dryRun: false })
      const migrations = await runner.getList()
      assert.lengthOf(migrations, 1)
      assert.match(migrations[0].name, /^schema\/\d{13}_create_masquerade_tables$/)
    } finally {
      await db.manager.closeAll()
      await f.dispose()
    }
  })

  test('reads named database exports before boot and Lucid discovers the generated migration', async ({
    assert,
  }) => {
    const f = await configureFixture(false)
    const connection = {
      client: 'better-sqlite3' as const,
      connection: { filename: join(f.root, 'db.sqlite3') },
      useNullAsDefault: true,
      migrations: { paths: ['schema/primary'] },
    }
    const db = new Database(
      { connection: 'primary', connections: { primary: connection } },
      new Logger({ name: 'configure', enabled: false }),
      new Emitter(f.app)
    )
    try {
      await writeFile(
        join(f.root, 'config/database.ts'),
        `export const connection = 'primary'\nexport const connections = ${JSON.stringify({ primary: connection })}\n`
      )
      const configured = f.command({ 'namespace': 'support', 'guard': 'web', 'no-wire': true })
      await configure(configured as never)
      assert.equal(configured.exitCode, 0, configured.errors.join('\n'))
      const runner = new MigrationRunner(db, f.app, { direction: 'up', dryRun: false })
      const list = await runner.getList()
      assert.lengthOf(list, 1)
      assert.match(list[0].name, /^schema\/primary\/\d{13}_create_masquerade_tables$/)
    } finally {
      await db.manager.closeAll()
      await f.dispose()
    }
  })

  test('force reruns retain the nested migration identity and create the schema once', async ({
    assert,
  }) => {
    const f = await configureFixture()
    const database = await sqlFixture({ createTables: false })
    const { db } = database
    try {
      await writeFile(
        join(f.root, 'package.json'),
        '{"name":"@kevinjohn/adonisjs-masquerade","type":"module","exports":{"./stores/lucid":"./schema.js"}}'
      )
      await writeFile(
        join(f.root, 'schema.js'),
        `export * from ${JSON.stringify(new URL('../stores/lucid.ts', import.meta.url).href)}\n`
      )
      const flags = { 'namespace': 'support', 'guard': 'web', 'no-wire': true }
      const first = f.command(flags)
      await configure(first as never)
      assert.equal(first.exitCode, 0, first.errors.join('\n'))
      const directory = join(f.root, 'database/migrations')
      const [file] = await readdir(directory)
      const nested = join(directory, 'prior#archive')
      const migration = '// Host migration edit\n' + (await readFile(join(directory, file), 'utf8'))
      await mkdir(nested)
      await rename(join(directory, file), join(nested, file))
      await writeFile(join(nested, file), migration)

      const runner = new MigrationRunner(db, f.app, { direction: 'up', dryRun: false })
      const before = await runner.getList()
      assert.deepEqual(before, [
        { name: `database/migrations/prior#archive/${file.slice(0, -3)}`, status: 'pending' },
      ])
      const rerun = f.command(flags)
      await configure(rerun as never)
      assert.equal(rerun.exitCode, 1)
      assert.deepEqual(await readdir(directory), ['prior#archive'])
      assert.equal(await readFile(join(nested, file), 'utf8'), migration)
      assert.deepEqual(await runner.getList(), before)

      const forced = f.command(flags, true)
      await configure(forced as never)
      assert.equal(forced.exitCode, 0, forced.errors.join('\n'))
      assert.deepEqual(await readdir(directory), ['prior#archive'])
      assert.equal(await readFile(join(nested, file), 'utf8'), migration)
      assert.deepEqual(await runner.getList(), before)
      await runner.run()
      assert.isNull(runner.error)
      assert.lengthOf(Object.keys(runner.migratedFiles), 1)
      assert.isTrue(await db.connection().schema.hasTable('masquerade_modes'))
      assert.isTrue(await db.connection().schema.hasTable('masquerade_events'))
      const rollback = new MigrationRunner(db, f.app, {
        direction: 'down',
        dryRun: false,
        batch: 0,
      })
      await rollback.run()
      assert.isNull(rollback.error)
      assert.isFalse(await db.connection().schema.hasTable('masquerade_modes'))
      assert.isFalse(await db.connection().schema.hasTable('masquerade_events'))
    } finally {
      try {
        await database.cleanup()
      } finally {
        await f.dispose()
      }
    }
  })

  test('force reuses a migration from a later Lucid directory and refuses competing migrations', async ({
    assert,
  }) => {
    const f = await configureFixture()
    try {
      const paths = ['database/migrations', 'database/archive']
      f.app.config.set('database', {
        connection: 'main',
        connections: { main: { migrations: { paths } } },
      })
      const [primary, archive] = paths.map((path) => join(f.root, path))
      const file = '1700000000000_create_masquerade_tables.ts'
      const archived = join(archive, file)
      const flags = { 'namespace': 'support', 'guard': 'web', 'no-wire': true }
      await mkdir(primary, { recursive: true })
      await mkdir(archive, { recursive: true })
      await writeFile(archived, '// Earlier scaffold')

      const forced = f.command(flags, true)
      await configure(forced as never)
      assert.equal(forced.exitCode, 0, forced.errors.join('\n'))
      assert.deepEqual(await readdir(primary), [])
      assert.deepEqual(await readdir(archive), [file])
      assert.equal(await readFile(archived, 'utf8'), '// Earlier scaffold')

      await writeFile(join(primary, file), '// Competing scaffold')
      const before = await snapshot(f.root)
      const duplicate = f.command({ ...flags, namespace: 'changed' }, true)
      await configure(duplicate as never)
      assert.equal(duplicate.exitCode, 1)
      assert.include(duplicate.errors.join('\n'), 'Multiple Masquerade migrations')
      assert.deepEqual(await snapshot(f.root), before)
    } finally {
      await f.dispose()
    }
  })

  test('force leaves a discoverable non-TypeScript migration untouched', async ({ assert }) => {
    const f = await configureFixture()
    try {
      const directory = join(f.root, 'database/migrations/prior')
      await mkdir(directory, { recursive: true })
      const file = join(directory, '1700000000000_create_masquerade_tables.cjs')
      const source = 'module.exports = class ExistingMigration {}'
      await writeFile(file, source)
      const forced = f.command({ 'namespace': 'support', 'guard': 'web', 'no-wire': true }, true)
      await configure(forced as never)
      assert.equal(forced.exitCode, 0, forced.errors.join('\n'))
      assert.equal(await readFile(file, 'utf8'), source)
      assert.deepEqual(await readdir(join(f.root, 'database/migrations')), ['prior'])
      assert.include(await readdir(join(f.root, 'config')), 'masquerade.ts')
    } finally {
      await f.dispose()
    }
  })

  test('reads config/database.ts when configure runs before the app boots', async ({ assert }) => {
    const f = await configureFixture()
    const load = f.app.import
    try {
      f.app.import = async (specifier: string) => {
        if (specifier === f.app.makeURL('config/database.ts').href)
          return {
            default: {
              connection: 'main',
              connections: { main: { migrations: { paths: ['database/schema'] } } },
            },
          }
        return load(specifier)
      }
      const configured = f.command({ namespace: 'support', guard: 'web' })
      await configure(configured as never)
      assert.equal(configured.exitCode, 0)
      const files = await readdir(join(f.root, 'database/schema'))
      assert.lengthOf(
        files.filter((file) => file.endsWith('_create_masquerade_tables.ts')),
        1
      )
    } finally {
      f.app.import = load
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
        missingLucid.errors.some((message) => message.includes('node ace add @adonisjs/lucid'))
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

async function configureFixture(boot = true) {
  const root = await mkdtemp(join(tmpdir(), 'masquerade-configure-'))
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'start'), { recursive: true })
  await mkdir(join(root, 'app/models'), { recursive: true })
  await writeFile(join(root, 'app/models/user.ts'), 'export default class User {}')
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
  if (boot) await app.boot()
  app.import = async (specifier) => {
    if (specifier === '@adonisjs/lucid') return {}
    if (specifier === '@adonisjs/assembler/code_transformer')
      return import('@adonisjs/assembler/code_transformer')
    if (specifier === app.makeURL('config/database.ts').href) return import(specifier)
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
    app,
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
    'app/controllers/masquerade_form_controller.ts',
  ]
  const paths: string[] = []
  for (const file of files) {
    try {
      await readFile(join(root, file))
      paths.push(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  let migrations: string[]
  try {
    migrations = await readdir(join(root, 'database/migrations'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    migrations = []
  }
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
    statusMiddleware: paths.includes('app/middleware/share_masquerade_status_middleware.ts')
      ? await read('app/middleware/share_masquerade_status_middleware.ts')
      : undefined,
    banner: paths.includes('resources/views/components/masquerade/banner.edge')
      ? await read('resources/views/components/masquerade/banner.edge')
      : undefined,
    formController: paths.includes('app/controllers/masquerade_form_controller.ts')
      ? await read('app/controllers/masquerade_form_controller.ts')
      : undefined,
    migration: await read(migrationPath),
  }
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const paths = await listScaffoldPaths(root)
  return Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), 'utf8')]))
  )
}
