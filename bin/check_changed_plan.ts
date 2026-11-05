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

// The examples workflow's pull request paths, plus the recipe's own script, configure and manifest.
const recipeInputs = [
  /^(examples|http|stubs|docs\/guide)\//,
  /^(configure\.ts|src\/configure_wiring\.ts)$/,
  /^bin\/test_recipe\.ts$/,
  /^package\.json$/,
]
// The docs workflow's push paths: TypeDoc reads the package source and treats warnings as errors.
const docsInputs = [
  /^(docs|account_kit|auth|commands|http|native|plugins|providers|src|stores|testing|stubs)\//,
  /^(index|configure)\.ts$/,
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json|typedoc\.json)$/,
]
const dependencyFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
// Formatter configuration (and package.json, which pins Prettier) can change any file's format.
const formatterInputs = [
  /^\.prettierrc/,
  /^\.prettierignore$/,
  /^\.editorconfig$/,
  /^package\.json$/,
]
// Inputs of the browser gates that only pnpm check --browser runs.
const browserInputs = [
  /^examples\/(?!recipe-host\/|account-kit\/)/,
  /^bin\/(demo|demo_account_kit|test_account_kit_demo|test_inertia_[a-z]+)\.ts$/,
  /^bin\/helpers\/(prepare_)?account_kit_demo[a-z_]*\.ts$/,
]
// Inputs of the consumer and Account Kit integration gates that only pnpm check --full runs.
const fullInputs = [
  /^(account_kit|native|auth)\//,
  /^examples\/(native-session|account-kit)\//,
  /^bin\/(test_consumer|test_account_kit)\.ts$/,
  /^bin\/helpers\/(consumer_[a-z_]+|registry_version|account_kit_host_wiring)\.ts$/,
]

const isSpec = (path: string) => /^tests\/.+\.spec\.ts$/.test(path)
const isTypeScript = (path: string) => /\.[cm]?tsx?$/.test(path)
const isEslintIgnored = (path: string) => /^(stubs|examples|tmp)\//.test(path)
const isLintable = (path: string) =>
  (/\.[cm]?[jt]sx?$/.test(path) && !isEslintIgnored(path)) || dependencyFiles.includes(path)

/** Files that cannot change the built package. Specs also read docs, workflows and examples. */
function outsidePackage(path: string): boolean {
  return /^(docs|examples|tests|\.github)\//.test(path) || /^[^/]+\.md$/.test(path)
}

export interface PlanOptions {
  /** Leave out every whole suite and the package build: one shared run covers them for a batch. */
  static?: boolean
}

/** Map the changed files to the repository scripts that check them. */
export function planChangedChecks(
  changes: ChangedFile[],
  { static: staticOnly = false }: PlanOptions = {}
): PlannedCheckStep[] {
  const paths = changes.map((change) => change.path)
  const present = changes.filter((change) => !change.deleted).map((change) => change.path)
  const formattable = present.filter((path) => path !== 'pnpm-lock.yaml')
  const specs = present.filter(isSpec)
  const suite = specs.length < changes.length
  const packageChanged = paths.some((path) => !outsidePackage(path))
  const browser = paths.some((path) => browserInputs.some((input) => input.test(path)))
  const full = paths.some((path) => fullInputs.some((input) => input.test(path)))
  const formatAll = paths.some((path) => formatterInputs.some((input) => input.test(path)))

  const step = (
    when: boolean,
    reason: string,
    label: string,
    command: string[],
    options: Omit<ChangedCheckStep, 'label' | 'command'> = {}
  ): PlannedCheckStep => (when ? { label, command, ...options } : { label, skip: reason })
  // Under --static a suite the files select is named in a skip line instead of run.
  const suiteStep = (
    when: boolean,
    reason: string,
    label: string,
    command: string[],
    stepOptions: Omit<ChangedCheckStep, 'label' | 'command'> = {}
  ): PlannedCheckStep =>
    when && staticOnly
      ? { label, skip: `--static leaves out ${command.join(' ')}` }
      : step(when, reason, label, command, stepOptions)
  const specsOnly = step(
    specs.length > 0,
    changes.length > 0 ? 'no test files changed' : 'no files changed',
    'tests',
    ['pnpm', 'quick:test', ...specs.map((path) => `--files=${path}`)],
    { countsTests: true, requiresTests: true }
  )

  return [
    formatAll
      ? { label: 'format', command: ['pnpm', 'format:check'] }
      : step(formattable.length > 0, 'no changed files to format', 'format', [
          'pnpm',
          'exec',
          'prettier',
          '--check',
          '--ignore-unknown',
          '--no-error-on-unmatched-pattern',
          ...formattable,
        ]),
    step(paths.some(isLintable), 'no lintable files changed', 'lint', ['pnpm', 'lint']),
    step(
      paths.some(
        (path) =>
          (isTypeScript(path) && !isEslintIgnored(path)) ||
          path === 'tsconfig.json' ||
          dependencyFiles.includes(path)
      ),
      'no TypeScript or type configuration changed',
      'typecheck',
      ['pnpm', 'typecheck']
    ),
    ...(!suite
      ? [specsOnly]
      : staticOnly
        ? [{ label: 'test suite', skip: '--static leaves out pnpm quick:test' }, specsOnly]
        : [
            {
              label: 'tests',
              command: ['pnpm', 'quick:test'],
              countsTests: true,
              requiresTests: true,
            },
          ]),
    suiteStep(packageChanged, 'no package source changed', 'build', ['pnpm', 'build']),
    suiteStep(
      packageChanged,
      'no package source changed',
      'built exports',
      ['pnpm', 'test:built-exports'],
      {
        countsTests: true,
        requiresTests: true,
      }
    ),
    suiteStep(
      paths.some((path) => recipeInputs.some((input) => input.test(path))),
      'no recipe inputs changed; pnpm check --full always runs it',
      'recipe',
      ['pnpm', 'test:recipe', '--database=sqlite']
    ),
    step(
      paths.some((path) => docsInputs.some((input) => input.test(path))),
      'no docs or TypeDoc inputs changed',
      'docs build',
      ['pnpm', 'docs:build'],
      {
        requiresCleanTree: true,
      }
    ),
    ...(browser ? [{ label: 'example browser suites', skip: 'run pnpm check --browser' }] : []),
    ...(full
      ? [{ label: 'consumer and Account Kit integration', skip: 'run pnpm check --full' }]
      : []),
  ]
}

/** Count the tests a Japa run executed from its summary line; 0 when none ran. */
export function executedTests(output: string): number {
  // eslint-disable-next-line no-control-regex
  const summary = output.replace(/\u001b\[[0-9;]*m/g, '').match(/^\s*Tests\s+(.+)$/m)?.[1] ?? ''
  return [...summary.matchAll(/(\d+) (passed|failed|regression)/g)].reduce(
    (total, match) => total + Number(match[1]),
    0
  )
}
