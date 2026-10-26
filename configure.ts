import type Configure from '@adonisjs/core/commands/configure'
import { access, readdir } from 'node:fs/promises'
import { wireHost } from './configure_wiring.js'

const fileDestinations = [
  'app/services/masquerade_user_provider.ts',
  'config/masquerade.ts',
  'providers/masquerade_native_provider.ts',
  'app/middleware/masquerade_context_middleware.ts',
] as const
const bannerDestinations = [
  'app/middleware/share_masquerade_status_middleware.ts',
  'resources/views/components/masquerade/banner.edge',
] as const

/** Scaffold a fail-closed native-session and Lucid setup without rewriting host auth. */
export async function configure(command: Configure): Promise<void> {
  const namespace = await readOption(command, 'namespace', 'Masquerade namespace')
  const guard = await readOption(command, 'guard', 'Raw session guard name')

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

  if (!(await fileExists(command.app.makePath('config/auth.ts')))) {
    command.logger.error(
      'config/auth.ts was not found. Configure @adonisjs/auth first, then rerun this command.'
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
      'Lucid is required for the default store scaffold. Install it with: pnpm add @adonisjs/lucid'
    )
    command.exitCode = 1
    return
  }

  const migrationFolder = 'database/migrations'
  const migrationFile = await findMigrationFile(command.app.makePath(migrationFolder))
  const migrationDestination = `${migrationFolder}/${migrationFile}`
  const banner = command.parsedFlags.banner === true
  const destinations = [
    ...fileDestinations,
    ...(banner ? bannerDestinations : []),
    migrationDestination,
  ]
  if (!command.force) {
    const existingPaths = await Promise.all(
      destinations.map(async (destination) =>
        (await fileExists(command.app.makePath(destination))) ? destination : null
      )
    ).then((paths) => paths.filter((path): path is string => path !== null))
    if (existingPaths.length) {
      command.logger.error(
        `Existing Masquerade files were left unchanged: ${existingPaths.join(', ')}. Rerun with --force to replace these generated paths.`
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
  const entity = command.app.generators.createEntity('masquerade_tables')
  const generated = [
    await codemods.makeUsingStub(command.stubsRoot, 'configure/user_provider.stub', {}),
    await codemods.makeUsingStub(command.stubsRoot, 'configure/masquerade_config.stub', {
      namespaceLiteral: JSON.stringify(namespace),
      guardLiteral: JSON.stringify(guard),
    }),
    await codemods.makeUsingStub(command.stubsRoot, 'configure/native_provider.stub', {}),
    await codemods.makeUsingStub(command.stubsRoot, 'configure/context_middleware.stub', {}),
    ...(banner
      ? [
          await codemods.makeUsingStub(command.stubsRoot, 'configure/status_middleware.stub', {}),
          await codemods.makeUsingStub(command.stubsRoot, 'configure/banner_edge.stub', {
            edgeOpen: '{{',
            edgeClose: '}}',
          }),
        ]
      : []),
    await codemods.makeUsingStub(command.stubsRoot, 'migrations/create_masquerade_tables.stub', {
      entity,
      flags: command.parsedFlags,
      migration: {
        tableName: 'masquerade_tables',
        folder: migrationFolder,
        fileName: migrationFile,
      },
    }),
  ]
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
  }) => {
    rcFile.addProvider('#providers/masquerade_native_provider')
    rcFile.addProvider('adonisjs-masquerade/providers/masquerade_provider')
    rcFile.addCommand('adonisjs-masquerade/commands')
  }) as RcFileUpdater)
  if (codemodError || (typeof command.exitCode === 'number' && command.exitCode !== 0)) {
    command.logger.error(
      'Generated files are present, but AdonisJS registration failed. Resolve the reported codemod error before booting the package.'
    )
    command.exitCode = 1
    return
  }

  const wiring = noWire(command)
    ? { auth: 'skipped', kernel: 'skipped', routes: 'skipped', status: 'skipped' }
    : await wireHost(command, codemods, guard, banner)
  if (wiring.auth !== 'skipped')
    command.logger.info(
      `Wired config/auth.ts: the raw ${guard} guard reuses userProvider and ${guard}_effective is the default guard.`
    )
  if (wiring.kernel !== 'skipped')
    command.logger.info(
      'Registered the context middleware after initialize_auth in start/kernel.ts.'
    )
  if (wiring.routes !== 'skipped')
    command.logger.info(
      'Mounted the control routes in start/masquerade_routes.ts with the limiters in start/masquerade_limiter.ts.'
    )
  if (banner && wiring.status !== 'skipped')
    command.logger.info(
      'Registered the optional banner status middleware after silent authentication; include components/masquerade/banner in an authenticated Edge layout.'
    )

  const rawGuardKey = JSON.stringify(guard)
  const effectiveGuardKey = JSON.stringify(`${guard}_effective`)
  const steps = [
    ...(wiring.auth === 'skipped'
      ? [
          'In your raw sessionGuard configuration, import userProvider from #services/masquerade_user_provider and pass that exact instance to sessionGuard. Keep the raw guard named web (or your --guard value).',
          `Wrap the raw factory with effectiveSessionGuard from adonisjs-masquerade/auth and make the wrapper the default auth guard, e.g. import { effectiveSessionGuard } from 'adonisjs-masquerade/auth'; default: ${effectiveGuardKey}; guards: { ${rawGuardKey}: rawGuard, ${effectiveGuardKey}: effectiveSessionGuard(rawGuard) }.`,
        ]
      : []),
    ...(wiring.kernel === 'skipped'
      ? [
          'Wire app/middleware/masquerade_context_middleware.ts as router middleware after initialize_auth and before any silent_auth middleware; preserve this order in start/kernel.ts.',
        ]
      : []),
    'Implement the generated account incarnation, security stamp, active-account checks, and deny-by-default policy using your account model. Make stamps change on privilege, password, suspension, and logout-all changes.',
    `Review the migration ${migrationDestination}, back up the database, then run: node ace migration:run`,
    ...(wiring.routes === 'skipped'
      ? [
          `Define separate start and stop limiters, then mount the controls with masqueradeRoutes(router, { auth: middleware.auth, guard: "${guard}", startLimiter, stopLimiter }) from adonisjs-masquerade/http; keep Shield CSRF enabled. Do not mount routes before those controls are in place.`,
        ]
      : []),
    ...(banner && wiring.status === 'skipped'
      ? [
          'Wire app/middleware/share_masquerade_status_middleware.ts in start/kernel.ts after silent_auth_middleware, then include components/masquerade/banner in an authenticated Edge layout. The middleware shares only safe status fields on authenticated effective-guard routes; public and raw control routes do not read mode status.',
        ]
      : []),
    'Keep context enforcement in report mode during form rollout; switch to enforce after clients submit the current context token. Host-managed retention never prunes idle rows.',
  ]
  command.logger.info(
    'Masquerade scaffold generated. Complete the host-specific wiring before enabling masquerade routes:'
  )
  steps.forEach((step, index) => command.logger.info(`${index + 1}. ${step}`))
}

function noWire(command: Configure): boolean {
  return command.parsedFlags.wire === false || command.parsedFlags['no-wire'] === true
}

async function readOption(command: Configure, key: 'namespace' | 'guard', label: string) {
  const value = command.parsedFlags[key]
  if (typeof value === 'string') return value
  return command.prompt.ask(label)
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

async function findMigrationFile(folder: string): Promise<string> {
  let files: string[] = []
  try {
    files = await readdir(folder)
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
  const existing = files
    .filter((file) => /^\d{13}_create_masquerade_tables\.ts$/.test(file))
    .sort()[0]
  return existing ?? `${Date.now()}_create_masquerade_tables.ts`
}

function isModuleNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_MODULE_NOT_FOUND'
  )
}
