import type Configure from '@adonisjs/core/commands/configure'
import type { CodeTransformer } from '@adonisjs/assembler/code_transformer'
import { access, readFile } from 'node:fs/promises'

type Project = CodeTransformer['project']
type SourceFile = NonNullable<ReturnType<Project['addSourceFileAtPathIfExists']>>

/** Outcome of one mechanical wiring step; `skipped` leaves the file unchanged. */
export type WiringOutcome = 'wired' | 'already' | 'skipped'

type Codemods = Awaited<ReturnType<Configure['createCodemods']>>

/**
 * Perform the mechanical host wiring after the scaffold is registered. Each step edits only a
 * recognised shape; anything else is skipped so configure prints the manual step instead.
 */
export async function wireHost(
  command: Configure,
  codemods: Codemods,
  guard: string,
  banner = false,
  formController = false
): Promise<Record<'auth' | 'kernel' | 'routes' | 'status', WiringOutcome>> {
  const project =
    typeof codemods.getTsMorphProject === 'function'
      ? await codemods.getTsMorphProject()
      : undefined
  if (!project) return { auth: 'skipped', kernel: 'skipped', routes: 'skipped', status: 'skipped' }
  const attempt = async (path: string, edit: () => Promise<WiringOutcome>) => {
    try {
      return await edit()
    } catch (error) {
      command.logger.info(`${path} was not edited: ${(error as Error)?.message ?? error}`)
      return 'skipped' as const
    }
  }
  const authPath = command.app.makePath('config/auth.ts')
  const kernelPath = command.app.makePath('start/kernel.ts')
  const auth = await attempt('config/auth.ts', () => wireAuthGuards(project, authPath, guard))
  const kernel = await attempt('start/kernel.ts', () => wireContextMiddleware(project, kernelPath))
  const status =
    banner && kernel !== 'skipped'
      ? await attempt('start/kernel.ts', () => wireStatusMiddleware(project, kernelPath))
      : 'skipped'
  const routes =
    auth === 'skipped' || kernel === 'skipped'
      ? 'skipped'
      : await attempt('start/masquerade_routes.ts', () =>
          wireControlRoutes(command, codemods, guard, kernelPath, formController)
        )
  return { auth, kernel, routes, status }
}

/** Generate the limiter and route files and preload them, when the host has `@adonisjs/limiter`. */
async function wireControlRoutes(
  command: Configure,
  codemods: Codemods,
  guard: string,
  kernelPath: string,
  formController: boolean
): Promise<WiringOutcome> {
  if (!(await exists(command.app.makePath('config/limiter.ts')))) return 'skipped'
  if (!/\bauth:\s*\(\)\s*=>\s*import\(/.test(await readFile(kernelPath, 'utf8'))) return 'skipped'
  const state = { guardQuoted: `'${guard}'` }
  const results = [
    await codemods.makeUsingStub(command.stubsRoot, 'configure/control_limiter.stub', state),
    await codemods.makeUsingStub(
      command.stubsRoot,
      formController ? 'configure/form_control_routes.stub' : 'configure/control_routes.stub',
      state
    ),
  ]
  if (results.some((result) => 'status' in result && result.status === 'skipped')) return 'skipped'
  type RcFileUpdater = Parameters<typeof codemods.updateRcFile>[0]
  await codemods.updateRcFile(((rcFile: { addPreloadFile(path: string): unknown }) => {
    rcFile.addPreloadFile('#start/masquerade_routes')
  }) as RcFileUpdater)
  return 'wired'
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** The settings AdonisJS codemods use when they save a transformed file. */
const editorSettings = {
  indentSize: 2,
  convertTabsToSpaces: true,
  trimTrailingWhitespace: true,
  ensureNewLineAtEndOfFile: true,
  indentStyle: 2,
  semicolons: 'remove',
} as unknown as Parameters<SourceFile['formatText']>[0]

const contextMiddleware = "() => import('#middleware/masquerade_context_middleware')"
const statusMiddleware = "() => import('#middleware/share_masquerade_status_middleware')"

// Minimal views of the ts-morph nodes these edits touch; the package does not depend on ts-morph.
interface AstNode {
  getKindName(): string
  getText(): string
}
interface CallNode extends AstNode {
  getExpression(): AstNode
  getArguments(): AstNode[]
}
interface ArrayNode extends AstNode {
  getElements(): AstNode[]
  insertElement(index: number, text: string): unknown
}
interface PropertyNode extends AstNode {
  getName(): string
  getInitializer(): AstNode | undefined
  setInitializer(text: string): unknown
  getChildIndex(): number
}
interface ObjectNode extends AstNode {
  getProperties(): AstNode[]
  getProperty(name: string): AstNode | undefined
  insertPropertyAssignment(index: number, structure: { name: string; initializer: string }): unknown
}

function is<T extends AstNode>(node: AstNode | undefined, kind: string): node is T {
  return node?.getKindName() === kind
}

function property(object: ObjectNode, name: string): PropertyNode | undefined {
  const found = object.getProperty(name)
  return is<PropertyNode>(found, 'PropertyAssignment') ? found : undefined
}

function call(node: AstNode | undefined, callee: string): CallNode | undefined {
  return is<CallNode>(node, 'CallExpression') && node.getExpression().getText() === callee
    ? node
    : undefined
}

function soleObjectArgument(node: CallNode | undefined): ObjectNode | undefined {
  const args = node?.getArguments() ?? []
  return args.length === 1 && is<ObjectNode>(args[0], 'ObjectLiteralExpression')
    ? args[0]
    : undefined
}

/**
 * Format like the AdonisJS codemods, then restore the starter's Prettier shape: a trailing comma
 * after the inserted entry and `{}` interface bodies.
 */
async function save(file: SourceFile, inserted: string): Promise<void> {
  file.formatText(editorSettings)
  file.replaceWithText(
    file
      .getFullText()
      .replace(`${inserted}\n`, `${inserted},\n`)
      .replace(/(\bextends [^\n{]+)\{ \}/g, '$1{}')
  )
  await file.save()
}

/** Register the context middleware right after `initialize_auth` in the router stack. */
export async function wireContextMiddleware(
  project: Project,
  kernelPath: string
): Promise<WiringOutcome> {
  const file = project.addSourceFileAtPathIfExists(kernelPath)
  if (!file) return 'skipped'
  const stacks = file
    .getDescendants()
    .map((node) => call(node as AstNode, 'router.use'))
    .filter((node): node is CallNode => node !== undefined)
  if (stacks.length !== 1) return 'skipped'
  const [list] = stacks[0].getArguments()
  if (!is<ArrayNode>(list, 'ArrayLiteralExpression')) return 'skipped'
  const entries = list.getElements().map((entry) => entry.getText())
  if (entries.some((entry) => entry.includes('#middleware/masquerade_context_middleware')))
    return 'already'
  const initialize = entries.findIndex((entry) =>
    entry.includes("'@adonisjs/auth/initialize_auth_middleware'")
  )
  const silent = entries.findIndex((entry) => entry.includes('silent_auth_middleware'))
  if (initialize === -1 || (silent !== -1 && silent < initialize)) return 'skipped'
  list.insertElement(initialize + 1, contextMiddleware)
  await save(file, contextMiddleware)
  return 'wired'
}

/** Register the opt-in status sharing middleware after silent auth, when present. */
export async function wireStatusMiddleware(
  project: Project,
  kernelPath: string
): Promise<WiringOutcome> {
  const file = project.addSourceFileAtPathIfExists(kernelPath)
  if (!file) return 'skipped'
  const stacks = file
    .getDescendants()
    .map((node) => call(node as AstNode, 'router.use'))
    .filter((node): node is CallNode => node !== undefined)
  if (stacks.length !== 1) return 'skipped'
  const [list] = stacks[0].getArguments()
  if (!is<ArrayNode>(list, 'ArrayLiteralExpression')) return 'skipped'
  const entries = list.getElements().map((entry) => entry.getText())
  if (entries.some((entry) => entry.includes('#middleware/share_masquerade_status_middleware')))
    return 'already'
  const context = entries.findIndex((entry) =>
    entry.includes('#middleware/masquerade_context_middleware')
  )
  const silent = entries.findIndex((entry) => entry.includes('silent_auth_middleware'))
  if (context === -1 || (silent !== -1 && silent < context)) return 'skipped'
  list.insertElement((silent === -1 ? context : silent) + 1, statusMiddleware)
  await save(file, statusMiddleware)
  return 'wired'
}

/**
 * Turn the starter-kit session guard into a raw guard that reuses the generated user provider,
 * add its effective guard and make that the default. Any other shape is left unchanged.
 */
export async function wireAuthGuards(
  project: Project,
  authPath: string,
  guard: string
): Promise<WiringOutcome> {
  const file = project.addSourceFileAtPathIfExists(authPath)
  if (!file) return 'skipped'
  const declaration = file.getVariableDeclaration('authConfig')
  const config = soleObjectArgument(
    call(declaration?.getInitializer() as AstNode | undefined, 'defineConfig')
  )
  if (!declaration || !config) return 'skipped'
  const effective = `${guard}_effective`
  const defaultGuard = property(config, 'default')
  const guards = property(config, 'guards')?.getInitializer()
  if (!defaultGuard || !is<ObjectNode>(guards, 'ObjectLiteralExpression')) return 'skipped'
  const defaultName = defaultGuard.getInitializer()?.getText()
  if (defaultName === `'${effective}'` && guards.getProperty(effective)) return 'already'
  if (defaultName !== `'${guard}'` || guards.getProperty(effective)) return 'skipped'

  const raw = property(guards, guard)
  const rawOptions = soleObjectArgument(call(raw?.getInitializer(), 'sessionGuard'))
  const provider = rawOptions && property(rawOptions, 'provider')
  const providerOptions = soleObjectArgument(
    call(provider?.getInitializer(), 'sessionUserProvider')
  )
  const model = providerOptions && property(providerOptions, 'model')
  if (
    !raw ||
    !provider ||
    providerOptions?.getProperties().length !== 1 ||
    model?.getInitializer()?.getText() !== "() => import('#models/user')"
  )
    return 'skipped'
  const rawName = `${guard.replace(/[-_]+([a-z0-9])/gi, (_, next: string) => next.toUpperCase())}Guard`
  const taken = ['userProvider', 'effectiveSessionGuard', rawName]
  if (
    taken.some(
      (name) =>
        file.getVariableDeclaration(name) ||
        file.getImportDeclaration((entry) =>
          entry.getNamedImports().some((named) => named.getName() === name)
        )
    )
  )
    return 'skipped'

  provider.setInitializer('userProvider')
  const rawFactory = raw.getInitializer()!.getText()
  raw.setInitializer(rawName)
  guards.insertPropertyAssignment(raw.getChildIndex() + 1, {
    name: /^[A-Za-z_$][\w$]*$/.test(effective) ? effective : `'${effective}'`,
    initializer: `effectiveSessionGuard(${rawName})`,
  })
  defaultGuard.setInitializer(`'${effective}'`)
  file.insertVariableStatement(declaration.getVariableStatementOrThrow().getChildIndex(), {
    declarationKind: 'const' as never,
    declarations: [{ name: rawName, initializer: rawFactory }],
  })

  const session = file.getImportDeclaration('@adonisjs/auth/session')
  const unused = session
    ?.getNamedImports()
    .find((named) => named.getName() === 'sessionUserProvider')
  if (unused && !/\bsessionUserProvider\b/.test(stripImports(file))) unused.remove()
  file.addImportDeclaration({
    moduleSpecifier: 'adonisjs-masquerade/auth',
    namedImports: ['effectiveSessionGuard'],
  })
  file.addImportDeclaration({
    moduleSpecifier: '#services/masquerade_user_provider',
    namedImports: ['userProvider'],
  })
  await save(file, `effectiveSessionGuard(${rawName})`)
  return 'wired'
}

function stripImports(file: SourceFile): string {
  return file
    .getStatements()
    .filter((statement) => statement.getKindName() !== 'ImportDeclaration')
    .map((statement) => statement.getText())
    .join('\n')
}
