import type Configure from '@adonisjs/core/commands/configure'
import { access, lstat, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Scaffold a fail-closed native session and Lucid setup and register its providers and commands.
 */
export async function configure(command: Configure): Promise<void> {
  const namespace = await readOption(command, 'namespace', 'Masquerade namespace')
  const guard = await readOption(command, 'guard', 'Raw session guard name')
  const directories = command.app.rcFile.directories
  const authFile = join(directories.config, 'auth.ts')
  const kernelFile = join(directories.start, 'kernel.ts')

  if (!isNamespace(namespace)) {
    command.logger.error(
      'Invalid namespace. Use 1–128 ASCII letters, numbers, _, ., :, or -; start with a letter or number.'
    )
    command.exitCode = 1
    return
  }
  if (!isGuardName(guard)) {
    command.logger.error(
      'Invalid guard name. Use 1–128 ASCII letters, numbers, _, or -; start with a letter.'
    )
    command.exitCode = 1
    return
  }

  if (!(await fileExists(command.app.configPath('auth.ts')))) {
    command.logger.error(
      `${authFile} was not found. Configure @adonisjs/auth first, then rerun this command.`
    )
    command.exitCode = 1
    return
  }

  // Every generated provider, config and limiter imports the starter kits' user model.
  const userModel = await resolveUserModelPath(command)
  if (
    !(await fileExists(command.app.makePath(`${userModel}.ts`))) &&
    !(await fileExists(command.app.makePath(`${userModel}.js`)))
  ) {
    command.logger.error(
      `The generated files import the user model from #models/user, but ${userModel}.ts was not found. Add the model there, as the AdonisJS starter kits do, then rerun this command.`
    )
    command.exitCode = 1
    return
  }

  try {
    await command.app.import('@adonisjs/assembler/code_transformer')
  } catch (error) {
    if (!isModuleNotFound(error)) throw error
    command.logger.error(
      'The AdonisJS assembler is required to register generated providers and commands. Install it with: pnpm add -D @adonisjs/assembler'
    )
    command.exitCode = 1
    return
  }

  try {
    await command.app.import('@adonisjs/lucid')
  } catch (error) {
    if (!isModuleNotFound(error)) throw error
    command.logger.error(
      'Lucid is required for the default store scaffold. Install and configure it with: node ace add @adonisjs/lucid'
    )
    command.exitCode = 1
    return
  }

  const migrationFolders = await resolveMigrationFolders(command)
  const migrations = await resolveMigrationPathsOrReport(command, migrationFolders)
  if (!migrations) return
  const migrationDestinations = migrations.map((migration) =>
    command.app.relativePath(migration.path)
  )
  const banner = command.parsedFlags.banner === true
  const formController =
    command.parsedFlags.formController === true || command.parsedFlags['form-controller'] === true
  const fileDestinations = [
    join(directories.services, 'masquerade_user_provider.ts'),
    join(directories.config, 'masquerade.ts'),
    join(directories.providers, 'masquerade_native_provider.ts'),
  ]
  const bannerDestinations = [
    join(directories.middleware, 'share_masquerade_status_middleware.ts'),
    join(directories.views, 'components/masquerade/banner.edge'),
  ]
  const formControllerDestination = join(
    directories.httpControllers,
    'masquerade_form_controller.ts'
  )
  const controlRoutes =
    command.parsedFlags.controlRoutes === true || command.parsedFlags['control-routes'] === true
  const routeDestinations = [
    join(directories.start, formController ? 'masquerade_form_routes.ts' : 'masquerade_routes.ts'),
    join(directories.start, 'masquerade_limiter.ts'),
  ]
  if (controlRoutes && !(await fileExists(command.app.configPath('limiter.ts')))) {
    command.logger.error('Configure @adonisjs/limiter before requesting --control-routes.')
    command.exitCode = 1
    return
  }
  const destinations = [
    ...fileDestinations,
    ...(banner ? bannerDestinations : []),
    ...(formController ? [formControllerDestination] : []),
    ...(controlRoutes ? routeDestinations : []),
  ].map((destination) => command.app.makePath(destination))
  destinations.push(...migrations.map((migration) => migration.path))
  if (!command.force) {
    const existingPaths = await Promise.all(
      destinations.map(async (destination) =>
        (await fileExists(destination)) ? command.app.relativePath(destination) : null
      )
    ).then((paths) => paths.filter((path): path is string => path !== null))
    if (existingPaths.length) {
      command.logger.error(
        `Existing Masquerade files were left unchanged: ${existingPaths.join(', ')}. Rerun with --force to refresh the scaffolds and preserve existing migrations.`
      )
      command.exitCode = 1
      return
    }
  }

  const codemods = await command.createCodemods()
  codemods.overwriteExisting = command.force === true
  let codemodError: unknown
  codemods.on('error', (error: unknown) => {
    codemodError = error
  })
  const generated = [
    await codemods.makeUsingStub(
      command.stubsRoot,
      'app/services/masquerade_user_provider.stub',
      {}
    ),
    await codemods.makeUsingStub(command.stubsRoot, 'config/masquerade.stub', {
      namespaceLiteral: JSON.stringify(namespace),
      guardLiteral: JSON.stringify(guard),
    }),
    await codemods.makeUsingStub(
      command.stubsRoot,
      'providers/masquerade_native_provider.stub',
      {}
    ),
    ...(banner
      ? [
          await codemods.makeUsingStub(
            command.stubsRoot,
            'app/middleware/share_masquerade_status_middleware.stub',
            {}
          ),
          await codemods.makeUsingStub(
            command.stubsRoot,
            'resources/views/components/masquerade/banner.stub',
            {
              edgeOpen: '{{',
              edgeClose: '}}',
            }
          ),
        ]
      : []),
    ...(formController
      ? [
          await codemods.makeUsingStub(
            command.stubsRoot,
            'app/controllers/masquerade_form_controller.stub',
            {}
          ),
        ]
      : []),
    ...(controlRoutes
      ? [
          await codemods.makeUsingStub(command.stubsRoot, 'start/masquerade_limiter.stub', {
            guardQuoted: JSON.stringify(guard),
          }),
          await codemods.makeUsingStub(
            command.stubsRoot,
            formController ? 'start/masquerade_form_routes.stub' : 'start/masquerade_routes.stub',
            { guardQuoted: JSON.stringify(guard) }
          ),
        ]
      : []),
  ]
  for (const migration of migrations.filter((entry) => !entry.exists)) {
    codemods.overwriteExisting = false
    generated.push(
      await codemods.makeUsingStub(
        command.stubsRoot,
        `make/migration/create_masquerade_${migration.table}.stub`,
        {
          // migrationsPath resolves through a URL; preserve literal characters in the folder.
          migrationDirectory: relative(command.app.migrationsPath(), dirname(migration.path))
            .split(sep)
            .map((segment) => encodeURIComponent(segment))
            .join('/'),
          migrationFile: basename(migration.path),
        }
      )
    )
    codemods.overwriteExisting = command.force === true
  }
  if (generated.some((result) => 'status' in result && result.status === 'skipped')) {
    command.logger.error(
      'One or more generated paths already existed and were skipped. No providers or commands were registered; review the partial files and rerun with --force if replacement is intended.'
    )
    command.exitCode = 1
    return
  }
  type RcFileUpdater = Parameters<typeof codemods.updateRcFile>[0]
  await codemods.updateRcFile(((rcFile: {
    addProvider(provider: string): unknown
    addCommand(command: string): unknown
    addPreloadFile(modulePath: string): unknown
  }) => {
    rcFile.addProvider('#providers/masquerade_native_provider')
    rcFile.addProvider('@kevinjohn/adonisjs-masquerade/masquerade_provider')
    rcFile.addCommand('@kevinjohn/adonisjs-masquerade/commands')
    if (controlRoutes)
      rcFile.addPreloadFile(
        formController ? '#start/masquerade_form_routes' : '#start/masquerade_routes'
      )
  }) as RcFileUpdater)
  await codemods.registerMiddleware('named', [
    { name: 'masquerade', path: '@kevinjohn/adonisjs-masquerade/route_marker_middleware' },
  ])
  // Appended to the router stack, so it runs after initialize_auth and silent_auth.
  if (banner)
    await codemods.registerMiddleware('router', [
      { path: '#middleware/share_masquerade_status_middleware', position: 'after' },
    ])
  if (codemodError || (typeof command.exitCode === 'number' && command.exitCode !== 0)) {
    command.logger.error(
      'Generated files are present, but AdonisJS registration failed. Resolve the reported codemod error before booting the package.'
    )
    command.exitCode = 1
    return
  }

  const rawGuardKey = JSON.stringify(guard)
  const effectiveGuardKey = JSON.stringify(`${guard}_effective`)
  const steps = [
    `Register () => import('@kevinjohn/adonisjs-masquerade/masquerade_context_middleware') as router middleware in ${kernelFile}, after initialize_auth and before any silent_auth middleware.`,
    `In ${authFile}, pass the generated userProvider from #services/masquerade_user_provider to your raw sessionGuard. Keep it named ${guard}, then make ${effectiveGuardKey} the default: guards: { ${rawGuardKey}: rawGuard, ${effectiveGuardKey}: effectiveSessionGuard(rawGuard) }. Import effectiveSessionGuard from @kevinjohn/adonisjs-masquerade/auth.`,
    'Implement the generated account incarnation, security stamp, active-account checks, and deny-by-default permissions using your account model. Make stamps change on privilege, password, suspension, and revoking all sessions.',
    `Review the migrations ${migrationDestinations.join(', ')}, back up the database, then run: node ace migration:run`,
    ...(controlRoutes
      ? [
          `Review the limiter budgets in ${routeDestinations[1]} and the routes in ${routeDestinations[0]}, which adonisrc.ts now preloads. Keep Shield CSRF enabled.`,
        ]
      : formController
        ? [
            `Mount GET /masquerade on MasqueradeController and POST /masquerade/start|stop on #controllers/masquerade_form_controller, behind middleware.auth({ guards: [${rawGuardKey}] }) with separate start/stop limiters. Keep Shield CSRF enabled.`,
          ]
        : [
            `Define separate start and stop limiters, then mount the controls with runtime.registerRoutes(router, { auth: middleware.auth, guard: ${rawGuardKey}, startLimiter, stopLimiter }), importing runtime from @kevinjohn/adonisjs-masquerade/services/main. Keep Shield CSRF enabled.`,
          ]),
    ...(formController
      ? [
          `Edit ${formControllerDestination} for your host redirect destinations and localised flash handling.`,
        ]
      : []),
    ...(banner
      ? [
          `Include components/masquerade/banner in an authenticated Edge layout. ${bannerDestinations[0]} is registered at the end of the router middleware in ${kernelFile}.`,
        ]
      : []),
    'Keep context enforcement in report mode during form rollout; switch to enforce after clients submit the current context token. Host-managed retention never prunes idle rows.',
  ]
  command.logger.info(
    'Masquerade scaffold generated. Complete these steps before enabling masquerade routes:'
  )
  steps.forEach((step, index) => command.logger.info(`${index + 1}. ${step}`))
}

async function readOption(command: Configure, key: 'namespace' | 'guard', label: string) {
  const value = command.parsedFlags[key]
  if (typeof value === 'string') return value
  // Ace parses numeric flag values: --namespace=2024 arrives as 2024, and --namespace=1e3 as 1000.
  if (typeof value === 'number') return readRawFlag(key) ?? String(value)
  return command.prompt.ask(label)
}

/** A flag's value as typed on the command line. */
function readRawFlag(name: string): string | undefined {
  const argv = process.argv
  for (const [index, argument] of argv.entries()) {
    if (argument === `--${name}`) return argv[index + 1]
    if (argument.startsWith(`--${name}=`)) return argument.slice(name.length + 3)
  }
  return undefined
}

type DatabaseConfig = {
  connection?: string
  connections?: Record<string, { migrations?: { paths?: unknown } }>
}

/** The default connection's migration directories, resolved as Lucid resolves them. */
async function resolveMigrationFolders(command: Configure): Promise<[string, ...string[]]> {
  // Configure runs before the application boots, so config/database.ts is read directly.
  const database =
    command.app.config?.get<DatabaseConfig | undefined>('database', undefined) ??
    (await loadDatabaseConfig(command))
  const paths = database?.connection
    ? database.connections?.[database.connection]?.migrations?.paths
    : undefined
  const [first, ...rest] = Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
    : []
  const resolveFolder = (path: string) => fileURLToPath(new URL(path, command.app.appRoot))
  if (first === undefined) {
    const directory =
      command.app.relativePath(command.app.migrationsPath()) || 'database/migrations'
    return [resolveFolder(`./${directory}`)]
  }
  return [resolveFolder(first), ...rest.map(resolveFolder)]
}

/** Where the host's `#models/*` import maps `#models/user`, without an extension. */
async function resolveUserModelPath(command: Configure): Promise<string> {
  let text: string | undefined
  try {
    text = await readFile(command.app.makePath('package.json'), 'utf8')
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
  // A package.json that exists but is not JSON stops configure rather than guessing the path.
  const target: unknown = text === undefined ? undefined : JSON.parse(text)?.imports?.['#models/*']
  return typeof target === 'string' && target.includes('*')
    ? target
        .replace('*', 'user')
        .replace(/^\.\//, '')
        .replace(/\.[cm]?[jt]s$/, '')
    : join(command.app.rcFile.directories.models, 'user')
}

/** `config/database.ts`, or `undefined` when the app has none. A file that fails to load throws. */
async function loadDatabaseConfig(command: Configure): Promise<DatabaseConfig | undefined> {
  try {
    const module = (await command.app.import(
      pathToFileURL(command.app.configPath('database.ts')).href
    )) as {
      default?: DatabaseConfig
    }
    return module.default ?? (module as DatabaseConfig)
  } catch (error) {
    if (!(await fileExists(command.app.configPath('database.ts')))) return undefined
    throw error
  }
}

function isNamespace(value: string): boolean {
  return Buffer.byteLength(value) <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)
}

function isGuardName(value: string): boolean {
  return Buffer.byteLength(value) <= 128 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return false
    throw error
  }
}

/**
 * Locate each existing table migration or select a new destination. A failure is logged, sets the exit code
 * and returns undefined.
 */
async function resolveMigrationPathsOrReport(
  command: Configure,
  folders: [string, ...string[]]
): Promise<{ path: string; exists: boolean; table: 'modes' | 'events' }[] | undefined> {
  const { sourceFiles } = await import('@adonisjs/lucid/utils')
  const infos = await Promise.all(
    folders.map((folder) =>
      stat(folder).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    )
  )
  const file = folders.find((_, index) => infos[index] && !infos[index].isDirectory())
  if (file) {
    command.logger.error(
      `Expected a migration directory at ${command.app.relativePath(file)}. Point the default connection migrations.paths at directories and rerun configure.`
    )
    command.exitCode = 1
    return
  }
  const discovered = await Promise.all(
    folders.map(async (folder) => {
      const { files } = await sourceFiles(pathToFileURL(folder + sep), '.', false)
      return files
    })
  )
  const migrations: { path: string; exists: boolean; table: 'modes' | 'events' }[] = []
  const timestamp = Date.now()
  for (const [index, table] of (['modes', 'events'] as const).entries()) {
    const suffix = `create_masquerade_${table}`
    const existing = discovered
      .flat()
      .filter(({ absPath }) =>
        new RegExp(`^\\d{13}_${suffix}$`).test(basename(absPath, extname(absPath)))
      )
    if (existing.length > 1) {
      command.logger.error(
        `Multiple Masquerade ${table} migrations were found in the default connection. Review migration history before rerunning configure.`
      )
      command.exitCode = 1
      return
    }
    if (existing[0]) {
      migrations.push({ path: existing[0].absPath, exists: true, table })
      continue
    }
    const path = join(folders[0], `${timestamp + index}_${suffix}.ts`)
    const entry = await lstat(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    if (entry) {
      command.logger.error(
        `The migration destination ${command.app.relativePath(path)} is occupied by an entry that Lucid ignores. Move it out of the migration directory and rerun configure.`
      )
      command.exitCode = 1
      return
    }
    migrations.push({ path, exists: false, table })
  }
  return migrations
}

function isModuleNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_MODULE_NOT_FOUND'
  )
}
