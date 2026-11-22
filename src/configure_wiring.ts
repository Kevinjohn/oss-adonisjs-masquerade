import type Configure from '@adonisjs/core/commands/configure'
import type { CodeTransformer } from '@adonisjs/assembler/code_transformer'
import { access, readFile } from 'node:fs/promises'

type Project = CodeTransformer['project']
type SourceFile = NonNullable<ReturnType<Project['addSourceFileAtPathIfExists']>>

/** Result of one mechanical wiring step; `skipped` leaves the file unchanged. */
export type WiringResult = 'wired' | 'already' | 'skipped'

type Codemods = Awaited<ReturnType<Configure['createCodemods']>>
type WireHostOptions = { banner: boolean; formController: boolean }

/**
 * Perform the mechanical host wiring after the scaffold is registered. Each step edits only a
 * recognized shape; anything else is skipped so configure prints the manual step instead.
 */
export async function wireHost(
  command: Configure,
  codemods: Codemods,
  guard: string,
  { banner, formController }: WireHostOptions
): Promise<Record<'auth' | 'kernel' | 'routes' | 'status', WiringResult>> {
  const project =
    typeof codemods.getTsMorphProject === 'function'
      ? await codemods.getTsMorphProject()
      : undefined
  if (!project) return { auth: 'skipped', kernel: 'skipped', routes: 'skipped', status: 'skipped' }
  const attempt = async (path: string, edit: () => Promise<WiringResult>) => {
    try {
      return await edit()
    } catch (error) {
      command.logger.info(
        `${command.app.relativePath(path)} was not edited: ${(error as Error)?.message ?? error}`
      )
      return 'skipped' as const
    }
  }
  const authPath = command.app.configPath('auth.ts')
  const kernelPath = command.app.startPath('kernel.ts')
  // The kernel goes first: switching the default guard without the context middleware would leave
  // view-only and sensitive() unenforced, so auth is wired only once the middleware is in place.
  const kernel = await attempt(kernelPath, () => wireContextMiddleware(project, kernelPath))
  const auth =
    kernel === 'skipped'
      ? 'skipped'
      : await attempt(authPath, () => wireAuthGuards(project, authPath, guard))
  const status =
    banner && kernel !== 'skipped'
      ? await attempt(kernelPath, () => wireStatusMiddleware(project, kernelPath))
      : 'skipped'
  const routes =
    auth === 'skipped' || kernel === 'skipped'
      ? 'skipped'
      : await attempt(command.app.startPath('masquerade_routes.ts'), () =>
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
): Promise<WiringResult> {
  if (!(await exists(command.app.configPath('limiter.ts')))) return 'skipped'
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

export const contextMiddleware =
  "() => import('@kevinjohn/adonisjs-masquerade/masquerade_context_middleware')"
const statusMiddleware = "() => import('#middleware/share_masquerade_status_middleware')"

// The 0.5.1 generated wrapper and the ./http default export remain recognised on configure reruns.
function isContextMiddleware(entry: string): boolean {
  return /^\s*(?:async\s+)?\(\s*\)\s*=>\s*import\s*\(\s*(['"])(?:#middleware\/masquerade_context_middleware|@kevinjohn\/adonisjs-masquerade\/(?:http|masquerade_context_middleware))\1\s*\)\s*$/.test(
    entry
  )
}

// Minimal views of the ts-morph nodes these edits touch; the package does not depend on ts-morph.
interface AstNode {
  getKindName(): string
  getText(): string
  getEnd(): number
  getStart(): number
  replaceWithText(text: string): unknown
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
interface FormattableSourceFile extends SourceFile {
  insertText(position: number, text: string): this
  getFullText(): string
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
 * Let ts-morph format the transformed file. Formatting the whole source file preserves runtime
 * string values; post-format text substitutions can accidentally edit matching string literals.
 */
async function save(file: SourceFile, inserted: string): Promise<void> {
  file.formatText(editorSettings)
  const formattable = file as FormattableSourceFile
  const insertedNode = file.getDescendants().find((node) => node.getText() === inserted)
  if (insertedNode && formattable.getFullText()[insertedNode.getEnd()] !== ',')
    formattable.insertText(insertedNode.getEnd(), ',')
  const authenticators = file
    .getDescendants()
    .filter(
      (node) =>
        node.getKindName() === 'InterfaceDeclaration' &&
        /\bextends [^\n{]+\{ \}$/.test(node.getText())
    )
    .sort((left, right) => right.getStart() - left.getStart())
  for (const node of authenticators) {
    const text = node.getText()
    const compact = text.replace(/(\bextends [^\n{]+)\{ \}$/, '$1{}')
    if (compact !== text) node.replaceWithText(compact)
  }
  await file.save()
}

function isConfiguredEffectiveGuard(
  file: SourceFile,
  guards: ObjectNode,
  guard: string,
  effective: string
): boolean {
  const raw = property(guards, guard)
  const wrapped = property(guards, effective)
  const rawName = raw?.getInitializer()?.getText()
  const wrapper = call(wrapped?.getInitializer(), 'effectiveSessionGuard')
  const wrappedName = wrapper?.getArguments()[0]?.getText()
  if (!rawName || wrappedName !== rawName || !/^[$A-Z_a-z][$\w]*$/.test(rawName)) return false
  const options = soleObjectArgument(
    call(file.getVariableDeclaration(rawName)?.getInitializer(), 'sessionGuard')
  )
  if (
    !wrapped ||
    !options ||
    property(options, 'provider')?.getInitializer()?.getText() !== 'userProvider' ||
    !hasNamedImportBinding(file, '@adonisjs/auth/session', 'sessionGuard') ||
    !hasNamedImportBinding(file, '#services/masquerade_user_provider', 'userProvider') ||
    !hasNamedImportBinding(file, '@kevinjohn/adonisjs-masquerade/auth', 'effectiveSessionGuard')
  )
    return false
  return true
}

function hasNamedImportBinding(file: SourceFile, moduleSpecifier: string, name: string): boolean {
  const bindings = file.getImportDeclarations().flatMap((declaration) => {
    const module = declaration.getModuleSpecifierValue()
    const imports: Array<{ local: string; imported: string; typeOnly?: boolean }> = []
    if (declaration.getDefaultImport())
      imports.push({ local: declaration.getDefaultImport()!.getText(), imported: 'default' })
    if (declaration.getNamespaceImport())
      imports.push({ local: declaration.getNamespaceImport()!.getText(), imported: '*' })
    for (const named of declaration.getNamedImports())
      imports.push({
        local: named.getAliasNode()?.getText() ?? named.getName(),
        imported: named.getName(),
        typeOnly: named.isTypeOnly(),
      })
    return imports.map((item) => ({
      ...item,
      module,
      typeOnly: declaration.isTypeOnly() || item.typeOnly,
    }))
  })
  const matching = bindings.filter((binding) => binding.local === name)
  return (
    matching.length === 1 &&
    matching[0].module === moduleSpecifier &&
    matching[0].imported === name &&
    !matching[0].typeOnly &&
    !file.getVariableDeclaration(name)
  )
}

/** Register the context middleware right after `initialize_auth` in the router stack. */
export async function wireContextMiddleware(
  project: Project,
  kernelPath: string
): Promise<WiringResult> {
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
  const contexts = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isContextMiddleware(entry))
  const initializers = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.includes("'@adonisjs/auth/initialize_auth_middleware'"))
  if (initializers.length !== 1) return 'skipped'
  const initialize = initializers[0].index
  const authBeforeInitialize = entries
    .slice(0, initialize)
    .some((entry) => entry.toLowerCase().includes('auth'))
  if (authBeforeInitialize) return 'skipped'
  if (contexts.length)
    return contexts.length === 1 && contexts[0].index === initialize + 1 ? 'already' : 'skipped'
  list.insertElement(initialize + 1, contextMiddleware)
  await save(file, contextMiddleware)
  return 'wired'
}

/** Register the opt-in status sharing middleware after silent auth, when present. */
export async function wireStatusMiddleware(
  project: Project,
  kernelPath: string
): Promise<WiringResult> {
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
  const context = entries.findIndex(isContextMiddleware)
  const silent = entries.findIndex((entry) => entry.includes('silent_auth_middleware'))
  if (context === -1 || (silent !== -1 && silent < context)) return 'skipped'
  list.insertElement((silent === -1 ? context : silent) + 1, statusMiddleware)
  await save(file, statusMiddleware)
  return 'wired'
}

function hasLocalBinding(file: SourceFile, name: string): boolean {
  if (file.getVariableDeclaration(name)) return true
  for (const declaration of file.getImportDeclarations()) {
    if (declaration.getDefaultImport()?.getText() === name) return true
    if (declaration.getNamespaceImport()?.getText() === name) return true
    if (
      declaration
        .getNamedImports()
        .some((named) => (named.getAliasNode()?.getText() ?? named.getName()) === name)
    )
      return true
  }
  return false
}

/**
 * Turn the starter-kit session guard into a raw guard that reuses the generated user provider,
 * add its effective guard and make that the default. Any other shape is left unchanged.
 */
export async function wireAuthGuards(
  project: Project,
  authPath: string,
  guard: string
): Promise<WiringResult> {
  const file = project.addSourceFileAtPathIfExists(authPath)
  if (!file) return 'skipped'
  const declaration = file.getVariableDeclaration('authConfig')
  const config = soleObjectArgument(
    call(declaration?.getInitializer() as AstNode | undefined, 'defineConfig')
  )
  if (!declaration || !config || !hasNamedImportBinding(file, '@adonisjs/auth', 'defineConfig'))
    return 'skipped'
  const effective = `${guard}_effective`
  const defaultGuard = property(config, 'default')
  const guards = property(config, 'guards')?.getInitializer()
  if (!defaultGuard || !is<ObjectNode>(guards, 'ObjectLiteralExpression')) return 'skipped'
  const defaultName = defaultGuard.getInitializer()?.getText()
  if (defaultName === `'${effective}'`)
    return isConfiguredEffectiveGuard(file, guards, guard, effective) ? 'already' : 'skipped'
  if (
    defaultName !== `'${guard}'` ||
    guards.getProperty(effective) ||
    !hasNamedImportBinding(file, '@adonisjs/auth/session', 'sessionGuard') ||
    !hasNamedImportBinding(file, '@adonisjs/auth/session', 'sessionUserProvider')
  )
    return 'skipped'

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
  const taken = new Set(['userProvider', 'effectiveSessionGuard', rawName])
  if ([...taken].some((name) => hasLocalBinding(file, name))) return 'skipped'

  provider.setInitializer('userProvider')
  const rawFactory = raw.getInitializer()!.getText()
  raw.setInitializer(rawName)
  guards.insertPropertyAssignment(guards.getProperties().indexOf(raw) + 1, {
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
    moduleSpecifier: '@kevinjohn/adonisjs-masquerade/auth',
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
