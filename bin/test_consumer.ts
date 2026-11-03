import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consumerArtifact } from './helpers/consumer_artifact.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...values] = arg.replace(/^--/, '').split('=')
    return [key, values.join('=')]
  })
)
const profile = args.get('profile') ?? 'all'
const database = args.get('database') ?? 'all'
if (!['all', 'floor', 'latest'].includes(profile) || !['all', 'sqlite', 'pg'].includes(database))
  throw new Error('Use --profile=floor|latest|all --database=sqlite|pg|all')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24')
const artifact = consumerArtifact(root, args.get('package'))
const digest = createHash('sha256')
  .update(await readFile(artifact))
  .digest('hex')
const directory = join(
  root,
  'tmp',
  'consumers',
  `${digest.slice(0, 12)}_${randomUUID().slice(0, 8)}`
)
await mkdir(directory, { recursive: true })
const floor = {
  '@adonisjs/core': '7.0.0',
  '@adonisjs/auth': '10.0.0',
  '@adonisjs/bouncer': '4.0.0',
  '@adonisjs/lucid': '22.4.2',
  '@adonisjs/session': '8.1.0',
  'typescript': '5.9.3',
}
const packedManifest = JSON.parse(
  execFileSync('tar', ['-xOf', artifact, 'package/package.json'], { encoding: 'utf8' })
)
const ranges: Record<string, string> = packedManifest.peerDependencies
for (const [name, version] of Object.entries(floor)) {
  const declaredFloor = ranges[name]?.match(/\d+\.\d+\.\d+/)?.[0]
  if (declaredFloor !== version)
    throw new Error(`Floor selection mismatch for ${name}: ${version} vs declared ${declaredFloor}`)
}
const results: unknown[] = []
let ownsPostgres = false
const baseEnv = {
  ...process.env,
  NODE_ENV: 'test',
  TZ: 'UTC',
  HOST: '127.0.0.1',
  PORT: '3333',
  APP_URL: 'http://127.0.0.1:3333',
  APP_KEY: 'consumer_fixture_key_01234567890123456789',
  LOG_LEVEL: 'error',
  SESSION_DRIVER: 'memory',
  FORCE_COLOR: '0',
  NO_COLOR: '1',
}

async function run(
  cwd: string,
  command: string[],
  name: string,
  env: NodeJS.ProcessEnv = baseEnv
): Promise<string> {
  console.log(`[consumer] ${name}: pnpm ${command.join(' ')}`)
  const output = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn('pnpm', command, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', (chunk) => {
      text += chunk
    })
    child.stderr.on('data', (chunk) => {
      text += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      void writeFile(join(directory, `${name}.log`), text).then(() => {
        if (code === 0) resolveOutput(text)
        else
          reject(
            new Error(
              `${name} failed (${code}); see ${join(directory, `${name}.log`)}\n${text.slice(-5000)}`
            )
          )
      }, reject)
    })
  })
  return output
}

async function verifyConfigure(app: string, profileName: string): Promise<void> {
  const check = join(app, 'configure-check')
  await mkdir(check, { recursive: true })
  for (const name of ['app', 'config', 'database', 'providers', 'start'])
    await cp(join(app, name), join(check, name), { recursive: true })
  await mkdir(join(check, 'bin'), { recursive: true })
  await cp(join(app, 'bin/console.ts'), join(check, 'bin/console.ts'))
  await mkdir(join(check, 'start'), { recursive: true })
  await cp(join(app, 'start/env.ts'), join(check, 'start/env.ts'))
  await cp(join(app, 'tsconfig.json'), join(check, 'tsconfig.json'))
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
  await writeFile(
    join(check, 'package.json'),
    JSON.stringify({ name: 'packed-configure-check', type: 'module', imports: manifest.imports })
  )
  await cp(join(app, 'ace.js'), join(check, 'ace.js'))
  for (const name of [
    'config/masquerade.ts',
    'providers/masquerade_native_provider.ts',
    'app/middleware/masquerade_context_middleware.ts',
  ])
    await rm(join(check, name), { force: true })
  const migrationRoot = join(check, 'database/migrations')
  for (const name of await readdir(migrationRoot))
    if (name.endsWith('_create_masquerade_tables.ts')) await rm(join(migrationRoot, name))
  await cp(join(app, 'adonisrc.ts'), join(check, 'adonisrc.ts'))
  try {
    await run(
      app,
      [
        'exec',
        'node',
        join(check, 'ace.js'),
        'configure',
        '@kevinjohn/adonisjs-masquerade',
        '--namespace=consumer_check',
        '--guard=web',
      ],
      `${profileName}_configure`
    )
    const config = await readFile(join(check, 'config/masquerade.ts'), 'utf8')
    if (!config.includes('consumer_check') || !config.includes('report'))
      throw new Error('Packed configure output omitted requested namespace or migration mode')
    for (const file of [
      'app/services/masquerade_user_provider.ts',
      'providers/masquerade_native_provider.ts',
      'app/middleware/masquerade_context_middleware.ts',
    ])
      await readFile(join(check, file), 'utf8')
    const migrations = await readdir(migrationRoot)
    if (migrations.filter((name) => name.endsWith('_create_masquerade_tables.ts')).length !== 1)
      throw new Error('Packed configure did not generate exactly one migration')
    await run(
      app,
      ['typecheck', '--project', join(check, 'tsconfig.json')],
      `${profileName}_configure_typecheck`
    )
  } finally {
    await rm(check, { recursive: true, force: true })
  }
}

const rootProbe = `import { registerHooks } from 'node:module'; import { access } from 'node:fs/promises'; import { join } from 'node:path'; registerHooks({resolve(specifier, context, next) { if ((specifier.startsWith('@adonisjs/') && specifier !== '@adonisjs/core/exceptions') || /account.?kit/i.test(specifier)) throw new Error('optional runtime import: '+specifier); return next(specifier, context) }}); const api = await import('@kevinjohn/adonisjs-masquerade'); for (const name of ['defineConfig','createMasqueradeService','configure']) if (typeof api[name] !== 'function') throw new Error('missing root export: '+name); if(typeof api.stubsRoot !== 'string') throw new Error('missing stubsRoot'); await access(join(api.stubsRoot,'migrations/create_masquerade_tables.stub')); await access(join(api.stubsRoot,'configure/masquerade_config.stub'));`

const providerProbe = `
  import assert from 'node:assert/strict'
  const provider = await import('@kevinjohn/adonisjs-masquerade/masquerade_provider')
  assert.equal(typeof provider.default, 'function')
  await assert.rejects(
    import('@kevinjohn/adonisjs-masquerade/providers/masquerade_provider'),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
  )
`

const pgEnv = {
  ...baseEnv,
  DB_CLIENT: 'pg',
  DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.DB_PORT ?? '55432',
  DB_USER: process.env.DB_USER ?? 'account_kit',
  DB_PASSWORD: process.env.DB_PASSWORD ?? '',
  DB_DATABASE: process.env.DB_DATABASE ?? 'package_test',
}
async function schema(cwd: string, name: string, action: 'create' | 'drop') {
  const sql =
    action === 'create' ? `create schema ${name}` : `drop schema if exists ${name} cascade`
  await run(
    cwd,
    [
      'exec',
      'node',
      '--input-type=module',
      '--eval',
      `import pg from 'pg'; const client=new pg.Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE}); await client.connect(); try {await client.query(${JSON.stringify(sql)})} finally {await client.end()}`,
    ],
    `${name}_${action}`,
    pgEnv
  )
}

try {
  for (const selected of profile === 'all' ? ['floor', 'latest'] : [profile]) {
    const versions: Record<string, string> = { ...floor }
    if (selected === 'latest')
      for (const name of Object.keys(floor)) {
        const listed = JSON.parse(
          await run(
            root,
            ['view', `${name}@${ranges[name]}`, 'version', '--json'],
            `latest_${name.replaceAll('/', '_')}`
          )
        ) as string | string[]
        const candidates = Array.isArray(listed) ? listed : [listed]
        versions[name] = candidates
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
          .at(-1)!
      }
    const app = await mkdtemp(join(tmpdir(), `masquerade_consumer_${selected}_`))
    console.log(`[consumer] isolated ${selected} app: ${app}`)
    await cp(join(root, 'examples/native-session'), app, {
      recursive: true,
      filter: (source) =>
        !relative(join(root, 'examples/native-session'), source)
          .split('/')
          .some((part) => ['node_modules', 'build', 'tmp', '.git', '.adonisjs'].includes(part)),
    })
    await mkdir(join(app, 'tmp'), { recursive: true })
    const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
    for (const [name, version] of Object.entries(versions)) {
      const section = name === 'typescript' ? 'devDependencies' : 'dependencies'
      manifest[section][name] = version
    }
    // Vite 6.0.2 requires Core >=7.5; 6.0.1 declares compatibility with Core 7.0.
    if (selected === 'floor') manifest.dependencies['@adonisjs/vite'] = '6.0.1'
    manifest.dependencies['@kevinjohn/adonisjs-masquerade'] = 'file:./package.tgz'
    await writeFile(
      join(app, 'pnpm-workspace.yaml'),
      JSON.stringify({ overrides: versions, allowBuilds: manifest.allowScripts }, null, 2) + '\n'
    )
    await cp(artifact, join(app, 'package.tgz'))
    await writeFile(join(app, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    const installation = await run(app, ['install', '--no-frozen-lockfile'], `${selected}_install`)
    if (/unmet peer|issues with peer dependencies|ERR_PNPM_PEER_DEP/i.test(installation))
      throw new Error('Consumer installation reports incompatible peer requirements')
    const storeEntries = await readdir(join(app, 'node_modules/.pnpm'))
    const semverEntry = storeEntries.find((entry) => entry.startsWith('semver@'))
    if (!semverEntry)
      throw new Error('Peer validation requires the installed tooling semver module')
    const requireTool = createRequire(join(app, 'package.json'))
    const semver = requireTool(
      join(app, 'node_modules/.pnpm', semverEntry, 'node_modules/semver')
    ) as { satisfies(version: string, range: string): boolean }
    const tooling: Record<string, string> = {}
    const dependencies: Record<string, string> = {}
    const installedPackages: Record<
      string,
      { version: string; peerDependencies?: Record<string, string> }
    > = {}
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      installedPackages[name] = JSON.parse(
        await readFile(join(app, 'node_modules', name, 'package.json'), 'utf8')
      )
      if (name in manifest.devDependencies) tooling[name] = installedPackages[name].version
      else dependencies[name] = installedPackages[name].version
    }
    let peerChecks = 0
    for (const [name, info] of Object.entries(installedPackages))
      for (const [peer, range] of Object.entries(info.peerDependencies ?? {})) {
        const installed = installedPackages[peer]
        if (!installed) continue
        peerChecks++
        if (!semver.satisfies(installed.version, range))
          throw new Error(
            `${name}@${info.version} requires peer ${peer}@${range}, installed ${installed.version}`
          )
      }

    const resolved: Record<string, string> = {}
    for (const [name, version] of Object.entries(versions)) {
      const installed = JSON.parse(
        await readFile(join(app, 'node_modules', name, 'package.json'), 'utf8')
      )
      resolved[name] = installed.version
      if (installed.version !== version)
        throw new Error(`${selected}: ${name} resolved ${installed.version}, expected ${version}`)
    }
    await run(
      app,
      ['exec', 'node', '--input-type=module', '--eval', rootProbe],
      `${selected}_optional_import`
    )
    await run(
      app,
      ['exec', 'node', '--input-type=module', '--eval', providerProbe],
      `${selected}_provider_exports`
    )
    await verifyConfigure(app, selected)
    if (args.has('scaffold-only')) {
      await writeFile(
        join(directory, `${selected}_scaffold.json`),
        JSON.stringify(
          {
            packageSha256: digest,
            profile: selected,
            versions: resolved,
            tooling,
            peerChecks,
            generatedScaffoldTypecheck: 'passed',
          },
          null,
          2
        ) + '\n'
      )
      console.log(`[consumer] PASS ${selected} packed scaffold typecheck`)
      continue
    }
    await run(app, ['lint'], `${selected}_lint`)
    await run(app, ['build'], `${selected}_build`)
    for (const engine of database === 'all' ? ['sqlite', 'pg'] : [database]) {
      const schemaName = `consumer_${selected}_${randomUUID().replaceAll('-', '')}`
      if (engine === 'pg' && !ownsPostgres && process.env.CONSUMER_PG_EXTERNAL !== '1') {
        const output = await run(root, ['pg:start'], 'postgres_start')
        ownsPostgres = !output.includes('already running')
      }
      const env =
        engine === 'pg' ? { ...pgEnv, DB_SCHEMA: schemaName } : { ...baseEnv, DB_CLIENT: 'sqlite' }
      if (engine === 'pg') await schema(app, schemaName, 'create')
      try {
        await run(app, ['typecheck'], `${selected}_${engine}_typecheck`, env)
        const functional = await run(
          app,
          ['test', 'functional'],
          `${selected}_${engine}_functional`,
          env
        )
        const tokenOnly = await run(
          app,
          ['test', 'token-only'],
          `${selected}_${engine}_token_only`,
          { ...env, MASQUERADE_TRANSPORT: 'tokens' }
        )
        const report = await run(app, ['test:report'], `${selected}_${engine}_report`, env)
        const credentials = await run(
          app,
          ['test:credentials'],
          `${selected}_${engine}_credentials`,
          env
        )
        const passCount = (text: string) => {
          const match = text.match(/(\d+)\s+passed/)
          if (!match) throw new Error('Missing consumer test pass count')
          return Number(match[1])
        }
        results.push({
          profile: selected,
          database: engine,
          peerRanges: ranges,
          versions: resolved,
          tooling,
          dependencies,
          peerChecks,
          incompatiblePeerWarnings: [],
          functional: passCount(functional),
          tokenOnly: passCount(tokenOnly),
          report: passCount(report),
          credentials: passCount(credentials),
          generatedScaffoldTypecheck: 'passed',
          fixtureLint: 'passed',
          fixtureBuild: 'passed',
          packageSha256: digest,
        })
        await writeFile(
          join(directory, 'results.json'),
          JSON.stringify(
            {
              artifact: basename(artifact),
              packageSha256: digest,
              nodeVersion: process.version,
              results,
            },
            null,
            2
          ) + '\n'
        )
        console.log(`[consumer] PASS ${selected}/${engine}`)
      } finally {
        if (engine === 'pg') await schema(app, schemaName, 'drop')
      }
    }
  }
} finally {
  if (ownsPostgres) await run(root, ['pg:stop'], 'postgres_stop')
}
console.log(
  `[consumer] Complete: ${args.has('scaffold-only') ? directory : join(directory, 'results.json')}`
)
