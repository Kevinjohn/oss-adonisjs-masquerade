import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  executedTests,
  planChangedChecks,
  type ChangedCheckStep,
  type ChangedFile,
} from './check_changed_plan.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const stepLimitMs = 15 * 60 * 1000
let active: ChildProcess | undefined

// Steps run detached, so an interrupt does not reach them: stop the running group before exiting.
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.on(signal, () => {
    try {
      if (active?.pid) process.kill(-active.pid, 'SIGTERM')
    } catch {}
    process.exit(code)
  })
}

function misuse(message: string): never {
  console.error(`[check:changed] ${message}`)
  process.exit(2)
}

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) misuse(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

function changedFiles(base: string): ChangedFile[] {
  const mergeBase = git(['merge-base', base, 'HEAD']).trim()
  const tracked = git(['diff', '--name-status', '--no-renames', '-z', mergeBase]).split('\0')
  const changes: ChangedFile[] = []
  for (let index = 0; index + 1 < tracked.length; index += 2) {
    changes.push({ path: tracked[index + 1], deleted: tracked[index] === 'D' })
  }
  for (const path of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) {
    if (path) changes.push({ path, deleted: false })
  }
  return changes
}

/** Run one step in its own process group so a timeout can stop the real test process too. */
function run(step: ChangedCheckStep): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(step.command[0], step.command.slice(1), {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    active = child
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    const timer = setTimeout(() => {
      output += `\n[check:changed] stopped after ${stepLimitMs / 60000} minutes\n`
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {}
    }, stepLimitMs)
    child.on('close', (status, signal) => {
      clearTimeout(timer)
      resolve({ status: signal ? null : status, output })
    })
  })
}

const args = process.argv.slice(2)
if (args.length > 1 || args[0]?.startsWith('-')) misuse('Use pnpm check:changed [base]')
if (Number(process.versions.node.split('.')[0]) !== 24) {
  misuse(`Use Node 24 (found ${process.version}); run nvm use`)
}
const base = args[0] ?? 'origin/main'
if (
  spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: root }).status
)
  misuse(`Unknown base ref ${base}`)

const changes = changedFiles(base)
console.log(`[check:changed] ${changes.length} changed files since the merge-base with ${base}`)
let failed = false
for (const step of planChangedChecks(changes)) {
  if ('skip' in step) {
    console.log(`skip ${step.label} (${step.skip})`)
    continue
  }
  const before = step.requiresCleanTree ? git(['status', '--porcelain']) : ''
  const { status, output } = await run(step)
  const tests = step.countsTests ? executedTests(output) : undefined
  const problem =
    status !== 0
      ? `exit ${status ?? 'killed'}`
      : step.requiresTests && tests === 0
        ? 'no tests executed'
        : step.requiresCleanTree && git(['status', '--porcelain']) !== before
          ? 'left the worktree dirty'
          : undefined
  if (problem) {
    failed = true
    console.log(`fail ${step.label} (${problem}): ${step.command.join(' ')}`)
    console.log(output.trimEnd().split('\n').slice(-40).join('\n'))
  } else {
    console.log(`pass ${step.label}${tests === undefined ? '' : ` (${tests} tests)`}`)
  }
}
process.exit(failed ? 1 : 0)
