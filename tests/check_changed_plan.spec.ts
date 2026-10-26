import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'
import {
  executedTests,
  planChangedChecks,
  type ChangedFile,
  type PlannedCheckStep,
} from '../bin/check_changed_plan.js'

const root = join(import.meta.dirname, '..')
const changed = (...paths: string[]): ChangedFile[] =>
  paths.map((path) => ({ path, deleted: false }))

function ran(plan: PlannedCheckStep[]): Record<string, string[]> {
  return Object.fromEntries(
    plan.flatMap((step) => ('command' in step ? [[step.label, step.command]] : []))
  )
}

test('a changed spec runs on its own and requires executed tests', ({ assert }) => {
  const plan = planChangedChecks(changed('tests/stamp_from.spec.ts'))
  const tests = plan.find((step) => step.label === 'tests')

  assert.deepEqual(Object.keys(ran(plan)), ['format', 'lint', 'typecheck', 'tests'])
  assert.deepInclude(tests, {
    command: ['pnpm', 'quick:test', '--files=tests/stamp_from.spec.ts'],
    countsTests: true,
    requiresTests: true,
  })
})

test('package source, test helpers and manifests run the full suite and built exports', ({
  assert,
}) => {
  for (const path of ['src/service.ts', 'tests/helpers/http_context.ts', 'package.json']) {
    const commands = ran(planChangedChecks(changed(path, 'tests/stamp_from.spec.ts')))
    assert.deepEqual(commands.tests, ['pnpm', 'quick:test'], path)
    assert.deepEqual(commands.build, ['pnpm', 'build'], path)
    assert.deepEqual(commands['built exports'], ['pnpm', 'test:built-exports'], path)
    assert.notProperty(commands, 'recipe', path)
  }
})

test('recipe inputs run the SQLite recipe', ({ assert }) => {
  for (const path of [
    'stubs/configure/masquerade_config.stub',
    'configure_wiring.ts',
    'examples/recipe-host/package.json',
    'docs/guide/clients/edge.md',
  ]) {
    assert.deepEqual(
      ran(planChangedChecks(changed(path))).recipe,
      ['pnpm', 'test:recipe', '--database=sqlite'],
      path
    )
  }
})

test('docs changes build the docs and require a clean tree, without the test suite', ({
  assert,
}) => {
  const plan = planChangedChecks(changed('docs/guide/route-report.md', 'SECURITY.md'))

  assert.deepEqual(Object.keys(ran(plan)), ['format', 'docs build'])
  assert.deepInclude(
    plan.find((step) => step.label === 'docs build'),
    { requiresCleanTree: true }
  )
})

test('deleted files select checks but are never passed to tools', ({ assert }) => {
  const commands = ran(
    planChangedChecks([
      { path: 'src/old_module.ts', deleted: true },
      { path: 'tests/old_module.spec.ts', deleted: true },
    ])
  )

  assert.notProperty(commands, 'format')
  assert.deepEqual(commands.typecheck, ['pnpm', 'typecheck'])
  assert.deepEqual(commands.tests, ['pnpm', 'quick:test'])
  assert.notInclude(commands.lint.join(' '), 'old_module')
})

test('formats only existing files and leaves the lockfile to pnpm', ({ assert }) => {
  const commands = ran(planChangedChecks(changed('README.md', 'pnpm-lock.yaml')))

  assert.deepEqual(commands.format.slice(-1), ['README.md'])
  assert.include(commands.format, '--ignore-unknown')
  assert.include(commands.format, '--no-error-on-unmatched-pattern')
})

test('lint allows no warnings and skips files ESLint ignores', ({ assert }) => {
  assert.deepEqual(ran(planChangedChecks(changed('http/controllers.ts'))).lint, [
    'pnpm',
    'lint',
    '--max-warnings',
    '0',
  ])
  assert.notProperty(ran(planChangedChecks(changed('examples/native-session/app/x.ts'))), 'lint')
})

test('other example changes are reported as skipped', ({ assert }) => {
  const plan = planChangedChecks(changed('examples/native-session/start/routes.ts'))

  assert.deepEqual(Object.keys(ran(plan)), ['format'])
  assert.deepInclude(plan, {
    label: 'examples',
    skip: 'covered by pnpm check --browser and the e2e workflow',
  })
})

test('counts executed tests from the Japa summary', ({ assert }) => {
  assert.equal(executedTests('\u001b[2mTests\u001b[22m  335 passed, 2 skipped (337)'), 335)
  assert.equal(executedTests('Tests  14 passed, 1 failed (15)'), 15)
  assert.equal(executedTests(' NO TESTS EXECUTED '), 0)
})

test('the package script runs the check:changed entry point', ({ assert }) => {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts

  assert.equal(
    scripts['check:changed'],
    'node --import=@poppinss/ts-exec --enable-source-maps bin/check_changed.ts'
  )
})
