import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as japaTest } from '@japa/runner'
import { actionUpdate, issueFor } from '../bin/helpers/dependency_updates.js'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const loaderPath = join(repositoryRoot, 'node_modules/@poppinss/ts-exec/build/index.js')
const action = 'actions/checkout'
const packageName = '@adonisjs/core'

// Stryker mutates src/ only. These CLI runs cannot kill a mutant and add seconds to every mutant's
// suite run; its initial dry run, which sets no active mutant, still runs them.
const mutantRun = Boolean(process.env.__STRYKER_ACTIVE_MUTANT__)

function test(title: string, callback: Parameters<typeof japaTest>[1]) {
  return japaTest(title, callback).skip(mutantRun, 'bin/ is not mutated')
}

interface FakeResponse {
  output?: string
  statusLine?: string
  separator?: '\n\n' | '\r\n\r\n'
  body?: string
  status?: number
  stderr?: string
}

interface FixtureOptions {
  latest?: FakeResponse
  confirmation?: { status?: number; stderr?: string }
  outdated?: Record<string, { current: string; latest: string }>
  repositoryUrl?: string
  existingIssues?: { number: number; title: string; body: string }[]
  removeGhAfterList?: boolean
  signalLatest?: boolean
}

interface Invocation {
  result: SpawnSyncReturns<string>
  trace: { command: string; args: string[] }[]
  npmCalled: boolean
}

function latestIssue(tag: string) {
  return issueFor(actionUpdate(action, 'v6', tag)!)!
}

function invokeCli(options: FixtureOptions = {}): Invocation {
  const directory = mkdtempSync(join(tmpdir(), 'dependency-issues-'))
  const bin = join(directory, 'bin')
  const workflowDirectory = join(directory, '.github/workflows')
  const tracePath = join(directory, 'trace.jsonl')
  const config = {
    latest: {
      statusLine: 'HTTP/1.1 200 OK',
      separator: '\r\n\r\n',
      body: JSON.stringify({ tag_name: 'v7.0.0' }),
      status: 0,
      ...options.latest,
    },
    confirmation: { status: 0, ...options.confirmation },
    outdated: options.outdated ?? {},
    repositoryUrl: options.repositoryUrl ?? 'git+https://github.com/vinejs/vine.git',
    existingIssues: options.existingIssues ?? [],
    removeGhAfterList: options.removeGhAfterList ?? false,
    signalLatest: options.signalLatest ?? false,
  }

  mkdirSync(bin)
  mkdirSync(workflowDirectory, { recursive: true })
  writeFileSync(
    join(workflowDirectory, 'check.yml'),
    'name: fixture\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@v6\n'
  )

  const fakeCommand = (body: string) => `#!${process.execPath}\n${body}`
  writeFileSync(
    join(bin, 'gh'),
    fakeCommand(`
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.TRACE_FILE, JSON.stringify({ command: 'gh', args }) + '\\n')
const config = JSON.parse(process.env.FAKE_CONFIG)
const issueList = ['issue', 'list', '--label', 'dependencies', '--state', 'open', '--limit', '200', '--json', 'number,title,body']
const latestRequest = ['api', 'repos/actions/checkout/releases/latest', '--include']
const releaseListRequest = ['api', 'repos/actions/checkout/releases?per_page=1', '--silent']
if (JSON.stringify(args) === JSON.stringify(issueList)) {
  process.stdout.write(JSON.stringify(config.existingIssues))
  if (config.removeGhAfterList) fs.unlinkSync(process.argv[1])
  process.exit(0)
}
if (JSON.stringify(args) === JSON.stringify(latestRequest)) {
  if (config.signalLatest) process.kill(process.pid, 'SIGTERM')
  const response = config.latest
  if (response.output !== undefined) process.stdout.write(response.output)
  else {
    process.stdout.write(response.statusLine + response.separator)
    process.stdout.write(response.body)
  }
  if (response.stderr) process.stderr.write(response.stderr)
  process.exit(response.status)
}
if (JSON.stringify(args) === JSON.stringify(releaseListRequest)) {
  if (config.confirmation.stderr) process.stderr.write(config.confirmation.stderr)
  process.exit(config.confirmation.status)
}
if (
  args[0] === 'issue' &&
  args[1] === 'create' &&
  args.length === 8 &&
  args[2] === '--label' &&
  args[3] === 'dependencies' &&
  args[4] === '--title' &&
  typeof args[5] === 'string' &&
  args[6] === '--body' &&
  typeof args[7] === 'string'
) process.exit(0)
if (
  args[0] === 'issue' &&
  args[1] === 'edit' &&
  args.length === 7 &&
  /^\\d+$/.test(args[2]) &&
  args[3] === '--title' &&
  typeof args[4] === 'string' &&
  args[5] === '--body' &&
  typeof args[6] === 'string'
) process.exit(0)
process.stderr.write('unexpected gh arguments: ' + args.join(' '))
process.exit(90)
`)
  )
  writeFileSync(
    join(bin, 'pnpm'),
    fakeCommand(`
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.TRACE_FILE, JSON.stringify({ command: 'pnpm', args }) + '\\n')
const config = JSON.parse(process.env.FAKE_CONFIG)
if (JSON.stringify(args) === JSON.stringify(['outdated', '--format', 'json'])) {
  process.stdout.write(JSON.stringify(config.outdated))
  process.exit(Object.keys(config.outdated).length ? 1 : 0)
}
if (
  args.length === 3 &&
  args[0] === 'view' &&
  args[1] === '@adonisjs/core' &&
  args[2] === 'repository.url'
) {
  process.stdout.write(config.repositoryUrl)
  process.exit(0)
}
process.exit(91)
`)
  )
  writeFileSync(
    join(bin, 'npm'),
    fakeCommand(`
const fs = require('node:fs')
fs.appendFileSync(process.env.TRACE_FILE, JSON.stringify({ command: 'npm', args: process.argv.slice(2) }) + '\\n')
process.exit(92)
`)
  )
  for (const command of ['gh', 'pnpm', 'npm']) chmodSync(join(bin, command), 0o755)

  try {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        loaderPath,
        '--enable-source-maps',
        join(repositoryRoot, 'bin/dependency_issues.ts'),
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          PATH: bin,
          TRACE_FILE: tracePath,
          FAKE_CONFIG: JSON.stringify(config),
        },
      }
    )

    const trace = existsSync(tracePath)
      ? readFileSync(tracePath, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : []
    const npmCalled = trace.some((entry) => entry.command === 'npm')
    return { result, trace, npmCalled }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function issueWrites(trace: Invocation['trace']) {
  return trace.filter(
    ({ command, args }) =>
      command === 'gh' && args[0] === 'issue' && ['create', 'edit'].includes(args[1])
  )
}

function hasIssueListRead(trace: Invocation['trace']) {
  return trace.some(
    ({ command, args }) => command === 'gh' && args[0] === 'issue' && args[1] === 'list'
  )
}

test('runs latest-release lookups with HTTP/1.x and HTTP/2 framing', ({ assert }) => {
  assert.isTrue(existsSync(loaderPath), `Expected absolute TypeScript loader at ${loaderPath}`)

  for (const latest of [
    {
      statusLine: 'HTTP/1.1 200 OK',
      separator: '\r\n\r\n' as const,
      body: JSON.stringify({ tag_name: 'v7.0.0' }),
      status: 0,
    },
    {
      statusLine: 'HTTP/2.0 200 OK',
      separator: '\n\n' as const,
      body: JSON.stringify({ tag_name: 'v7.0.0' }),
      status: 0,
    },
  ]) {
    const { result, trace } = invokeCli({ latest })
    assert.equal(result.status, 0, result.stderr)
    assert.isTrue(hasIssueListRead(trace))
    assert.deepEqual(
      issueWrites(trace).map(({ args }) => args[1]),
      ['create']
    )
    const write = issueWrites(trace)[0]
    assert.include(write.args.join(' '), 'https://github.com/actions/checkout/releases/tag/v7.0.0')
    assert.deepEqual(
      trace.find(({ command, args }) => command === 'gh' && args[0] === 'api')?.args,
      ['api', 'repos/actions/checkout/releases/latest', '--include']
    )
  }
})

test('retains existing issue no-op and edit behavior', ({ assert }) => {
  const existingV7 = { number: 17, ...latestIssue('v7.0.0') }
  const matching = invokeCli({ existingIssues: [existingV7] })
  assert.equal(matching.result.status, 0, matching.result.stderr)
  assert.deepEqual(issueWrites(matching.trace), [])

  const newer = invokeCli({
    latest: { body: JSON.stringify({ tag_name: 'v8.0.0' }) },
    existingIssues: [existingV7],
  })
  assert.equal(newer.result.status, 0, newer.result.stderr)
  assert.deepEqual(
    issueWrites(newer.trace).map(({ args }) => args.slice(0, 3)),
    [['issue', 'edit', '17']]
  )
})

test('skips only a confirmed missing latest release and continues with npm updates', ({
  assert,
}) => {
  const { result, trace } = invokeCli({
    latest: {
      statusLine: 'HTTP/2 404 Not Found',
      separator: '\r\n\r\n',
      body: '{"message":"Not Found"}',
      status: 1,
      stderr: 'HTTP 404',
    },
    outdated: { [packageName]: { current: '7.1.0', latest: '7.2.0' } },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.include(result.stderr, `No latest release found for ${action}; skipped`)
  assert.isTrue(hasIssueListRead(trace))
  assert.deepEqual(
    issueWrites(trace).map(({ args }) => args.slice(0, 2)),
    [['issue', 'create']]
  )
  assert.deepEqual(
    trace.find(
      ({ command, args }) =>
        command === 'gh' && args[0] === 'api' && args[1].endsWith('?per_page=1')
    )?.args,
    ['api', 'repos/actions/checkout/releases?per_page=1', '--silent']
  )
})

test('fails incomplete release scans before creating or editing any issue', ({ assert }) => {
  const scenarios: { name: string; options: FixtureOptions; diagnostic: string }[] = [
    {
      name: 'inaccessible 404 confirmation',
      options: {
        latest: {
          statusLine: 'HTTP/1.1 404 Not Found',
          separator: '\n\n',
          body: '{"message":"Not Found"}',
          status: 1,
          stderr: 'original latest 404 failure',
        },
        confirmation: { status: 1, stderr: 'release-list permission denied' },
      },
      diagnostic: 'release-list confirmation failed',
    },
    ...[401, 403, 429, 500].map((status) => ({
      name: `HTTP ${status}`,
      options: {
        latest: {
          statusLine: `HTTP/1.1 ${status} Failure`,
          separator: '\r\n\r\n' as const,
          body: '{"message":"request failed"}',
          status: 1,
          stderr: `server returned ${status}`,
        },
      },
      diagnostic: `HTTP ${status}`,
    })),
    {
      name: 'transport error without a response',
      options: { latest: { output: '', status: 1, stderr: 'socket hang up' } },
      diagnostic: 'malformed HTTP response',
    },
    {
      name: 'signalled latest-release command',
      options: { signalLatest: true },
      diagnostic: 'signal SIGTERM',
    },
    {
      name: 'latest-release command spawn failure after issue-list read',
      options: { removeGhAfterList: true },
      diagnostic: 'Unable to read latest release',
    },
    {
      name: 'HTTP and process status mismatch',
      options: {
        latest: {
          statusLine: 'HTTP/1.1 200 OK',
          separator: '\n\n',
          body: JSON.stringify({ tag_name: 'v7.0.0' }),
          status: 1,
          stderr: 'request failed after response',
        },
      },
      diagnostic: 'HTTP 200',
    },
    {
      name: 'malformed response framing',
      options: { latest: { output: 'not an HTTP response', status: 1 } },
      diagnostic: 'malformed HTTP response',
    },
    {
      name: 'malformed latest-release JSON',
      options: {
        latest: {
          statusLine: 'HTTP/2 200 OK',
          separator: '\r\n\r\n',
          body: '{bad json',
          status: 0,
        },
      },
      diagnostic: 'Unable to parse latest release',
    },
    ...[
      ['missing tag_name', '{}'],
      ['non-string tag_name', '{"tag_name":7}'],
      ['empty tag_name', '{"tag_name":""}'],
    ].map(([name, body]) => ({
      name,
      options: {
        latest: {
          statusLine: 'HTTP/2 200 OK',
          separator: '\n\n' as const,
          body,
          status: 0,
        },
      },
      diagnostic: 'no valid tag_name',
    })),
    {
      name: 'success process status contradicts HTTP 404',
      options: {
        latest: {
          statusLine: 'HTTP/1.1 404 Not Found',
          separator: '\r\n\r\n',
          body: '{"message":"Not Found"}',
          status: 0,
        },
      },
      diagnostic: 'HTTP 404',
    },
  ]

  for (const scenario of scenarios) {
    const invocation = invokeCli({
      ...scenario.options,
      outdated: { [packageName]: { current: '7.1.0', latest: '7.2.0' } },
    })
    const output = `${invocation.result.stdout}\n${invocation.result.stderr}`
    assert.notEqual(invocation.result.status, 0, `${scenario.name} unexpectedly succeeded`)
    assert.isTrue(
      hasIssueListRead(invocation.trace),
      `${scenario.name} did not read existing issues`
    )
    assert.deepEqual(issueWrites(invocation.trace), [], `${scenario.name} wrote an issue`)
    assert.include(output, scenario.diagnostic, `${scenario.name} lost its failure meaning`)
    if (scenario.name === 'inaccessible 404 confirmation') {
      assert.include(output, 'original latest 404 failure')
    }
    assert.notInclude(output, `No latest release found for ${action}; skipped`)
  }
})

test('uses pnpm view for release metadata and preserves the normalized GitHub link', ({
  assert,
}) => {
  const { result, trace, npmCalled } = invokeCli({
    latest: { body: JSON.stringify({ tag_name: 'v6.0.0' }) },
    outdated: { [packageName]: { current: '7.1.0', latest: '7.2.0' } },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.isFalse(npmCalled)
  assert.deepEqual(
    trace.find(({ command, args }) => command === 'pnpm' && args[0] === 'view')?.args,
    ['view', packageName, 'repository.url']
  )
  const write = issueWrites(trace)[0]
  assert.isDefined(write)
  assert.include(write.args.join(' '), 'https://github.com/vinejs/vine/releases')
})
