/** A file changed since the merge-base. Deleted files select checks but are never passed to tools. */
export interface ChangedFile {
  path: string
  deleted: boolean
}

/** One `pnpm` command run by `pnpm check:changed`. */
export interface ChangedCheckStep {
  label: string
  command: string[]
  /** Report the number of tests the step executed. */
  countsTests?: boolean
  /** Fail when the step executes no tests: its file filter is wrong. */
  requiresTests?: boolean
  /** Fail when the step leaves the worktree dirty. */
  requiresCleanTree?: boolean
}

export interface SkippedCheckStep {
  label: string
  skip: string
}

export type PlannedCheckStep = ChangedCheckStep | SkippedCheckStep

const recipeInputs = [
  /^stubs\//,
  /^configure(_wiring)?\.ts$/,
  /^examples\/recipe-host\//,
  /^bin\/test_recipe\.ts$/,
  /^docs\/guide\/(setup|usage)\.md$/,
  /^docs\/guide\/clients\/edge\.md$/,
]

const isDocs = (path: string) => path.startsWith('docs/')
const isExample = (path: string) => path.startsWith('examples/')
const isSpec = (path: string) => /^tests\/.+\.spec\.ts$/.test(path)
const isTypeScript = (path: string) => /\.[cm]?tsx?$/.test(path)
const isEslintIgnored = (path: string) => /^(stubs|examples|tmp)\//.test(path)
const isLintable = (path: string) =>
  (/\.[cm]?[jt]sx?$/.test(path) && !isEslintIgnored(path)) || path === 'package.json'

/** Files that cannot affect the SQLite suite or the built package. Anything else runs both. */
function outsideSuite(path: string): boolean {
  return (
    isDocs(path) ||
    isExample(path) ||
    path.startsWith('.github/') ||
    /^[^/]+\.md$/.test(path) ||
    isSpec(path)
  )
}

/** Map the changed files to the repository scripts that check them. */
export function planChangedChecks(changes: ChangedFile[]): PlannedCheckStep[] {
  const paths = changes.map((change) => change.path)
  const present = changes.filter((change) => !change.deleted).map((change) => change.path)
  const formattable = present.filter((path) => path !== 'pnpm-lock.yaml')
  const suite = changes.some(
    (change) => !outsideSuite(change.path) || (isSpec(change.path) && change.deleted)
  )
  const specs = present.filter(isSpec)
  const examples = paths.filter(
    (path) => isExample(path) && !path.startsWith('examples/recipe-host/')
  )

  const step = (
    when: boolean,
    reason: string,
    label: string,
    command: string[],
    options: Omit<ChangedCheckStep, 'label' | 'command'> = {}
  ): PlannedCheckStep => (when ? { label, command, ...options } : { label, skip: reason })

  return [
    step(formattable.length > 0, 'no changed files to format', 'format', [
      'pnpm',
      'exec',
      'prettier',
      '--check',
      '--ignore-unknown',
      '--no-error-on-unmatched-pattern',
      ...formattable,
    ]),
    step(paths.some(isLintable), 'no lintable files changed', 'lint', [
      'pnpm',
      'lint',
      '--max-warnings',
      '0',
    ]),
    step(
      paths.some(
        (path) =>
          (isTypeScript(path) && !isEslintIgnored(path)) ||
          path === 'tsconfig.json' ||
          path === 'package.json'
      ),
      'no TypeScript or type configuration changed',
      'typecheck',
      ['pnpm', 'typecheck']
    ),
    suite
      ? { label: 'tests', command: ['pnpm', 'quick:test'], countsTests: true, requiresTests: true }
      : step(
          specs.length > 0,
          'no package source or specs changed',
          'tests',
          ['pnpm', 'quick:test', ...specs.map((path) => `--files=${path}`)],
          { countsTests: true, requiresTests: true }
        ),
    step(suite, 'no package source changed', 'build', ['pnpm', 'build']),
    step(suite, 'no package source changed', 'built exports', ['pnpm', 'test:built-exports'], {
      countsTests: true,
      requiresTests: true,
    }),
    step(
      paths.some((path) => recipeInputs.some((input) => input.test(path))),
      'no stubs, configure code or recipe fences changed',
      'recipe',
      ['pnpm', 'test:recipe', '--database=sqlite']
    ),
    step(paths.some(isDocs), 'no docs changed', 'docs build', ['pnpm', 'docs:build'], {
      requiresCleanTree: true,
    }),
    ...(examples.length > 0
      ? [
          {
            label: 'examples',
            skip: 'covered by pnpm check --browser and the e2e workflow',
          },
        ]
      : []),
  ]
}

/** Count the tests a Japa run executed from its summary line; 0 when none ran. */
export function executedTests(output: string): number {
  // eslint-disable-next-line no-control-regex
  const summary = output.replace(/\u001b\[[0-9;]*m/g, '').match(/^\s*Tests\s+(.+)$/m)?.[1] ?? ''
  return [...summary.matchAll(/(\d+) (passed|failed)/g)].reduce(
    (total, match) => total + Number(match[1]),
    0
  )
}
