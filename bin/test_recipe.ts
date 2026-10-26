import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const template = join(root, 'examples/recipe-host')
let activeChild: ChildProcess | undefined
let interrupted: NodeJS.Signals | undefined
let finishStartup = false
let termination: Promise<void> | undefined

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

async function waitForGroupExit(pid: number, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds
  while (signalGroup(pid, 0)) {
    if (Date.now() >= deadline) return false
    await new Promise((resume) => setTimeout(resume, 100))
  }
  return true
}

async function terminateGroup(pid: number): Promise<void> {
  if (!signalGroup(pid, 'SIGTERM')) return
  if (await waitForGroupExit(pid, 5000)) return
  signalGroup(pid, 'SIGKILL')
  if (!(await waitForGroupExit(pid, 5000))) {
    throw new Error(`Interrupted process group ${pid} did not exit`)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (interrupted) return
    interrupted = signal
    process.exitCode = 1
    if (activeChild?.pid && !finishStartup) {
      termination = terminateGroup(activeChild.pid)
      void termination.catch(() => {})
    }
  })
}
const database = process.argv.find((arg) => arg.startsWith('--database='))?.split('=')[1] ?? 'all'
if (!['sqlite', 'pg', 'all'].includes(database)) throw new Error('Use --database=sqlite|pg|all')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24')

const setup = await readFile(join(root, 'docs/guide/setup.md'), 'utf8')
const usage = await readFile(join(root, 'docs/guide/usage.md'), 'utf8')
const edge = await readFile(join(root, 'docs/guide/clients/edge.md'), 'utf8')

function fence(markdown: string, name: string): string {
  const marker = `<!-- host-recipe:${name} -->`
  const position = markdown.indexOf(marker)
  if (position < 0 || markdown.indexOf(marker, position + marker.length) >= 0)
    throw new Error(`Expected one ${name} recipe marker`)
  const remaining = markdown.slice(position + marker.length)
  const nextMarker = remaining.indexOf('<!-- host-recipe:')
  const nextHeading = remaining.search(/^## /m)
  const ends = [nextMarker, nextHeading].filter((index) => index >= 0)
  const section = remaining.slice(0, ends.length ? Math.min(...ends) : undefined)
  const match = section.match(/^[\s\S]*?```(?:ts|edge)\n([\s\S]*?)\n```/)
  if (!match) throw new Error(`Missing ${name} recipe fence`)
  return match[1] + '\n'
}

const snippets = {
  webGuard: fence(setup, 'web-guard'),
  memberGuard: fence(setup, 'member-guard'),
  authConfig: fence(setup, 'auth-config'),
  identityPolicy: fence(setup, 'identity-policy'),
  kernelOrder: fence(setup, 'kernel-order'),
  controlRoutes: fence(usage, 'control-routes'),
  controlLimiters: fence(usage, 'control-limiters'),
  businessRoutes: fence(usage, 'business-routes'),
  htmlRoutes: fence(edge, 'html-control-routes'),
}

function requireRecipe(condition: boolean, detail: string): void {
  if (!condition) throw new Error(`Public recipe drift: ${detail}`)
}

function verifyRecipe(parts: typeof snippets): void {
  requireRecipe(parts.webGuard.includes('useRememberMeTokens: true'), 'raw session options')
  requireRecipe(parts.webGuard.includes('#services/masquerade_user_provider'), 'shared provider')
  requireRecipe(parts.memberGuard.includes('useRememberMeTokens: false'), 'second guard options')
  requireRecipe(parts.authConfig.includes('members: memberGuard'), 'second guard registration')
  requireRecipe(parts.authConfig.includes('InferAuthenticators<typeof authConfig>'), 'Auth types')
  requireRecipe(parts.authConfig.includes("default: 'web_effective'"), 'effective default')
  requireRecipe(parts.controlRoutes.includes("guard: 'web',"), 'raw control guard')
  requireRecipe(
    parts.controlRoutes.includes('startLimiter: startMasqueradeLimiter'),
    'start limiter'
  )
  requireRecipe(parts.controlRoutes.includes('stopLimiter: stopMasqueradeLimiter'), 'stop limiter')
  requireRecipe(
    parts.businessRoutes.match(/guards: \['web_effective'\]/g)?.length === 3,
    'effective business guards'
  )
  requireRecipe(parts.businessRoutes.includes('.use(allowMutation())'), 'mutation marker')
  requireRecipe(parts.businessRoutes.includes('.use(sensitive())'), 'sensitive marker')
  const init = parts.kernelOrder.indexOf("'@adonisjs/auth/initialize_auth_middleware'")
  const context = parts.kernelOrder.indexOf("'#middleware/masquerade_context_middleware'")
  const silent = parts.kernelOrder.indexOf("'#middleware/silent_auth_middleware'")
  requireRecipe(init >= 0 && init < context && context < silent, 'context middleware order')
  requireRecipe(
    parts.identityPolicy.includes('actor.user.masqueradeOperator'),
    'deny-by-default policy'
  )
}

verifyRecipe(snippets)
for (const [name, mutated] of [
  [
    'raw guard',
    {
      ...snippets,
      controlRoutes: snippets.controlRoutes.replace("guard: 'web',", "guard: 'web_effective',"),
    },
  ],
  [
    'middleware order',
    {
      ...snippets,
      kernelOrder: snippets.kernelOrder.replace(
        "() => import('#middleware/masquerade_context_middleware'),\n  () => import('#middleware/silent_auth_middleware')",
        "() => import('#middleware/silent_auth_middleware'),\n  () => import('#middleware/masquerade_context_middleware')"
      ),
    },
  ],
] as const) {
  let rejected = false
  try {
    verifyRecipe(mutated)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error(`Recipe negative check did not reject changed ${name}`)
}

function extract(text: string, pattern: RegExp, label: string): string {
  const match = text.match(pattern)
  if (!match) throw new Error(`Missing documented ${label}`)
  return match[0]
}

function replaceOnce(source: string, pattern: RegExp, replacement: string, label: string): string {
  if (!pattern.test(source)) throw new Error(`Host lacks ${label} insertion seam`)
  return source.replace(pattern, replacement)
}

async function run(
  cwd: string,
  args: string[],
  label: string,
  env: NodeJS.ProcessEnv,
  cleanup = false,
  completeOnInterrupt = false
): Promise<string> {
  if (interrupted && !cleanup) throw new Error(`Recipe interrupted by ${interrupted}`)
  console.log(`[recipe] ${label}: pnpm ${args.join(' ')}`)
  return new Promise((resolveOutput, reject) => {
    const child = spawn('pnpm', args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeChild = child
    finishStartup = completeOnInterrupt
    if (interrupted && child.pid && !completeOnInterrupt && !cleanup) {
      termination = terminateGroup(child.pid)
      void termination.catch(() => {})
    }
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', (error) => {
      if (activeChild === child) activeChild = undefined
      reject(error)
    })
    child.on('close', async (code) => {
      if (activeChild === child) activeChild = undefined
      finishStartup = false
      try {
        if (termination) {
          await termination
          termination = undefined
        }
        if (interrupted && !cleanup && !completeOnInterrupt)
          throw new Error(`Recipe interrupted by ${interrupted}`)
        if (code !== 0) throw new Error(`${label} failed (${code}):\n${output.slice(-6000)}`)
        resolveOutput(output)
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function writeHost(app: string, path: string, contents: string): Promise<void> {
  const destination = join(app, path)
  await mkdir(resolve(destination, '..'), { recursive: true })
  await writeFile(destination, contents)
}

async function expectBrokenJourney(
  app: string,
  path: string,
  originalText: string,
  brokenText: string,
  label: string,
  expectedAssertion: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const destination = join(app, path)
  const original = await readFile(destination, 'utf8')
  requireRecipe(original.includes(originalText), `${label} mutation seam`)
  await writeFile(destination, original.replace(originalText, brokenText))
  try {
    let expectedFailure = false
    try {
      await run(app, ['test'], `${label} negative journey`, env)
    } catch (error) {
      const output = String(error)
      expectedFailure =
        output.includes(`${label} negative journey failed`) &&
        output.includes(expectedAssertion) &&
        output.includes('1 failed')
      if (!expectedFailure) throw error
    }
    if (!expectedFailure) throw new Error(`${label} broken host unexpectedly passed`)
    console.log(`[recipe] PASS ${label} broken-host negative`)
  } finally {
    await writeFile(destination, original)
  }
}

async function applyRecipe(app: string): Promise<void> {
  await writeHost(app, 'app/services/web_guard.ts', snippets.webGuard)
  await writeHost(app, 'app/services/member_guard.ts', snippets.memberGuard)
  await writeHost(app, 'config/auth.ts', snippets.authConfig)

  const configPath = join(app, 'config/masquerade.ts')
  let config = await readFile(configPath, 'utf8')
  config = replaceOnce(
    config,
    /const nativeAdapter = sessionAuthority<User>\(\{[\s\S]*?\n\}\)/,
    extract(
      snippets.identityPolicy,
      /const nativeAdapter = sessionAuthority<User>\(\{[\s\S]*?\n\}\)/,
      'native callbacks'
    ),
    'generated native callbacks'
  )
  config = replaceOnce(
    config,
    / {2}policy: \{[\s\S]*?\n {2}\},/,
    extract(snippets.identityPolicy, / {2}policy: \{[\s\S]*?\n {2}\},/, 'host policy'),
    'generated host policy'
  )
  config = replaceOnce(
    config,
    /contextEnforcement: 'report'/,
    "contextEnforcement: 'enforce'",
    'context enforcement'
  )
  config = replaceOnce(
    config,
    /function configureAccountIdentity\(\): never \{[\s\S]*?\n\}\n/,
    '',
    'unused generated callback placeholder'
  )
  await writeFile(configPath, config)

  const kernelPath = join(app, 'start/kernel.ts')
  const kernel = await readFile(kernelPath, 'utf8')
  const contextLine = extract(
    snippets.kernelOrder,
    / {2}\(\) => import\('#middleware\/masquerade_context_middleware'\),/,
    'context middleware import'
  )
  const authLine = extract(
    snippets.kernelOrder,
    / {2}\(\) => import\('@adonisjs\/auth\/initialize_auth_middleware'\),/,
    'Auth middleware import'
  )
  await writeFile(
    kernelPath,
    replaceOnce(
      kernel,
      / {2}\(\) => import\('@adonisjs\/auth\/initialize_auth_middleware'\),/,
      `${authLine}\n${contextLine}`,
      'auth middleware order'
    )
  )

  await writeHost(app, 'start/masquerade_control_limiter.ts', snippets.controlLimiters)
  await writeHost(app, 'start/masquerade_control_routes.ts', snippets.controlRoutes)
  await writeHost(app, 'start/recipe_business_routes.ts', snippets.businessRoutes)
  await writeHost(app, 'start/recipe_html_routes.ts', snippets.htmlRoutes)
  await writeHost(
    app,
    'resources/views/masquerade_banner.edge',
    "@include('components/masquerade/banner')\n"
  )
  await cp(
    join(app, 'recipe-assets/masquerade_controller.ts.txt'),
    join(app, 'app/controllers/masquerade_controller.ts')
  )
  await cp(
    join(app, 'recipe-assets/demo_controller.ts.txt'),
    join(app, 'app/controllers/demo_controller.ts')
  )
  await cp(
    join(app, 'recipe-assets/journey.spec.ts.txt'),
    join(app, 'tests/functional/journey.spec.ts')
  )
  const routesPath = join(app, 'start/routes.ts')
  await writeFile(
    routesPath,
    (await readFile(routesPath, 'utf8')) +
      "\nimport '#start/masquerade_control_routes'\nimport '#start/recipe_business_routes'\nimport '#start/recipe_html_routes'\n"
  )
  const statusKernelPath = join(app, 'start/kernel.ts')
  const statusKernel = await readFile(statusKernelPath, 'utf8')
  await writeFile(
    statusKernelPath,
    replaceOnce(
      statusKernel,
      / {2}\(\) => import\('#middleware\/silent_auth_middleware'\),/,
      "  () => import('#middleware/silent_auth_middleware'),\n  () => import('#middleware/share_masquerade_status_middleware'),",
      'generated status middleware'
    )
  )
  await writeHost(
    app,
    'start/recipe_banner_route.ts',
    `import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

router
  .get('/support/banner', async ({ view }) => view.render('masquerade_banner'))
  .use(middleware.auth({ guards: ['web_effective'] }))

router.get('/support/public-banner', async ({ view }) => view.render('masquerade_banner'))
`
  )
  await writeFile(
    routesPath,
    (await readFile(routesPath, 'utf8')) + "import '#start/recipe_banner_route'\n"
  )
}

const selected = database === 'all' ? ['sqlite', 'pg'] : [database]
const baseEnv = {
  ...process.env,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3396',
  APP_URL: 'http://127.0.0.1:3396',
  APP_KEY: 'recipe_host_key_01234567890123456789',
  LOG_LEVEL: 'error',
  SESSION_DRIVER: 'memory',
  LIMITER_STORE: 'memory',
  DB_PORT: process.env.DB_PORT ?? '55536',
  DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
  DB_USER: process.env.DB_USER ?? 'account_kit',
  DB_PASSWORD: process.env.DB_PASSWORD ?? '',
  DB_DATABASE: process.env.DB_DATABASE ?? 'account_kit_test',
  FORCE_COLOR: '0',
  NO_COLOR: '1',
}

await run(root, ['build'], 'build package', baseEnv)
await run(root, ['pack:fixture'], 'pack package', baseEnv)
const artifact = join(root, 'tmp/native-session-package.tgz')
let ownsPostgres = false
try {
  for (const engine of selected) {
    const app = await mkdtemp(join(tmpdir(), `masquerade_recipe_${engine}_`))
    const schemaName = `recipe_${randomUUID().replaceAll('-', '')}`
    const env = { ...baseEnv, DB_CLIENT: engine, DB_SCHEMA: schemaName }
    let schemaCreationAttempted = false
    try {
      await cp(template, app, {
        recursive: true,
        filter: (path) =>
          !relative(template, path)
            .split('/')
            .some((part) => ['node_modules', 'build', '.adonisjs', 'tmp'].includes(part)),
      })
      await mkdir(join(app, 'tmp'), { recursive: true })
      await cp(artifact, join(app, 'package.tgz'))
      const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
      manifest.dependencies['adonisjs-masquerade'] = 'file:./package.tgz'
      await writeFile(join(app, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
      await writeFile(
        join(app, 'pnpm-workspace.yaml'),
        "allowBuilds:\n  '@swc/core': true\n  better-sqlite3: true\n"
      )
      await run(app, ['install', '--no-frozen-lockfile'], `${engine} install`, env)
      const before = await readFile(join(app, 'config/auth.ts'), 'utf8')
      requireRecipe(
        before.includes("default: 'web'") && !before.includes('web_effective'),
        'host was prewired'
      )
      await run(
        app,
        [
          'exec',
          'node',
          'ace.js',
          'configure',
          'adonisjs-masquerade',
          '--namespace=my_app',
          '--guard=web',
          '--banner',
          '--form-controller',
          '--no-wire',
        ],
        `${engine} configure`,
        env
      )
      await applyRecipe(app)
      if (engine === 'pg') {
        if (process.env.RECIPE_PG_EXTERNAL !== '1') {
          const startup = await run(root, ['pg:start'], 'start PostgreSQL', env, false, true)
          if (startup.includes(`already running on port ${env.DB_PORT}`)) {
            console.log('[recipe] using existing managed PostgreSQL')
          } else if (startup.includes('server started')) {
            ownsPostgres = true
          } else {
            throw new Error(`Cannot determine PostgreSQL startup ownership:\n${startup}`)
          }
        }
        const sql = `create schema ${schemaName}`
        schemaCreationAttempted = true
        await run(
          app,
          [
            'exec',
            'node',
            '--input-type=module',
            '--eval',
            `import pg from 'pg'; const c=new pg.Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE}); await c.connect(); try { await c.query(${JSON.stringify(sql)}) } finally { await c.end() }`,
          ],
          'create PostgreSQL schema',
          env
        )
      }
      await run(app, ['typecheck'], `${engine} typecheck`, env)
      await run(app, ['test'], `${engine} journey`, env)
      await expectBrokenJourney(
        app,
        'app/controllers/masquerade_form_controller.ts',
        'const hidden = body._masqueradeContext',
        'const hidden = body.contextToken',
        'form token',
        'recipe form start',
        env
      )
      await expectBrokenJourney(
        app,
        'start/kernel.ts',
        "  () => import('#middleware/masquerade_context_middleware'),\n",
        '',
        'context middleware',
        'sensitive handler must not execute',
        env
      )
      await run(app, ['test'], `${engine} restored journey`, env)
      console.log(`[recipe] PASS ${engine}`)
    } finally {
      let cleanupError: unknown
      if (engine === 'pg' && schemaCreationAttempted) {
        const sql = `drop schema if exists ${schemaName} cascade`
        try {
          await run(
            app,
            [
              'exec',
              'node',
              '--input-type=module',
              '--eval',
              `import pg from 'pg'; const c=new pg.Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE}); await c.connect(); try { await c.query(${JSON.stringify(sql)}) } finally { await c.end() }`,
            ],
            'drop PostgreSQL schema',
            env,
            true
          )
        } catch (error) {
          cleanupError = error
        }
      }
      await rm(app, { recursive: true, force: true })
      if (cleanupError) {
        console.error(cleanupError)
        process.exitCode = 1
      }
    }
  }
} finally {
  if (ownsPostgres) await run(root, ['pg:stop'], 'stop PostgreSQL', baseEnv, true)
}
if (interrupted) throw new Error(`Recipe interrupted by ${interrupted}`)
