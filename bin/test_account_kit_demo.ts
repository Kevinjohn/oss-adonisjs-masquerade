import { appendFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatDemoSchema } from './helpers/account_kit_demo_format.ts'
import { runDemoCommand } from './helpers/account_kit_demo_process.ts'
import { prepare } from './helpers/prepare_account_kit_demo.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = join(root, 'tmp/account-kit-demo-check')
const port = 3398

function assertNode24(): void {
  if (Number(process.versions.node.split('.')[0]) !== 24)
    throw new Error(
      `The Account Kit demo check requires Node.js 24; found ${process.versions.node}`
    )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runAccountKitDemoCheck(): Promise<void> {
  assertNode24()
  const controller = new AbortController()
  let interrupted: 'SIGINT' | 'SIGTERM' | undefined
  const interrupt = (name: 'SIGINT' | 'SIGTERM') => {
    if (interrupted) return
    interrupted = name
    controller.abort()
  }
  const onInt = () => interrupt('SIGINT')
  const onTerm = () => interrupt('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)
  let logPath: string | undefined
  const started = Date.now()
  let outcome = 'passed'
  try {
    const preparationStart = Date.now()
    const prepared = await prepare(workspace, { port, signal: controller.signal })
    logPath = join(prepared.workspace, 'check.log')
    await writeFile(
      logPath,
      [
        'Account Kit demo finite check',
        `workspace: ${prepared.workspace}`,
        `port: ${port}`,
        `runtime: Node.js ${process.versions.node} (${process.execPath})`,
        `preparation command: prepare(${prepared.workspace}, { port: ${port} })`,
        `preparation: passed (${Date.now() - preparationStart} ms)`,
        '',
      ].join('\n')
    )
    const stage = async (name: string, command: string, action: () => Promise<void>) => {
      const start = Date.now()
      console.log(`\nAccount Kit demo check: ${name}`)
      await appendFile(logPath!, `${name}: started — ${command}\n`)
      try {
        controller.signal.throwIfAborted()
        await action()
        await appendFile(logPath!, `${name}: passed (${Date.now() - start} ms)\n`)
      } catch (error) {
        await appendFile(
          logPath!,
          `${name}: ${controller.signal.aborted ? 'interrupted' : 'failed'} (${Date.now() - start} ms) — ${describeError(error)}\n`
        )
        throw error
      }
    }
    const ace = (name: string, args: string[], env = prepared.env) =>
      stage(name, `node ace.js ${args.join(' ')}`, () =>
        runDemoCommand(process.execPath, ['ace.js', ...args], prepared.app, env, controller.signal)
      )
    await ace('migration', ['migration:run'])
    await ace('codegen', ['codegen'])
    await stage('schema format', 'pnpm exec prettier --write database/schema.ts', () =>
      formatDemoSchema(prepared.app, prepared.env, controller.signal)
    )
    await stage('lint', 'pnpm lint', () =>
      runDemoCommand('pnpm', ['lint'], prepared.app, prepared.env, controller.signal)
    )
    await stage('typecheck', 'pnpm typecheck', () =>
      runDemoCommand('pnpm', ['typecheck'], prepared.app, prepared.env, controller.signal)
    )
    const testEnv = { ...prepared.env, NODE_ENV: 'test' }
    await ace('functional', ['test', 'functional'], testEnv)
    await ace('browser', ['test', 'browser'], testEnv)
    console.log('Account Kit demo finite check passed')
  } catch (error) {
    outcome = interrupted ? `interrupted by ${interrupted}` : `failed: ${describeError(error)}`
    if (!interrupted) throw error
  } finally {
    controller.abort()
    if (interrupted) outcome = `interrupted by ${interrupted}`
    try {
      if (logPath) {
        await appendFile(logPath, `\nresult: ${outcome}\nduration: ${Date.now() - started} ms\n`)
        console.log(`Account Kit demo check log: ${logPath}`)
      }
    } finally {
      process.off('SIGINT', onInt)
      process.off('SIGTERM', onTerm)
      if (interrupted) process.exitCode = interrupted === 'SIGINT' ? 130 : 143
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAccountKitDemoCheck().catch((error) => {
    console.error(`Account Kit demo check failed: ${describeError(error)}`)
    if (process.exitCode !== 130 && process.exitCode !== 143) process.exitCode = 1
  })
}
