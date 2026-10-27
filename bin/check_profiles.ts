/** One `pnpm` script run by `pnpm check`, optionally inside an example application. */
export interface CheckStep {
  script: string
  args?: string[]
  directory?: string
  env?: Record<string, string>
}
export type CheckProfile = 'quick' | 'full' | 'browser'

const browserEnv = { DB_CLIENT: 'sqlite', HOST: '127.0.0.1', SESSION_DRIVER: 'memory' }

/** Steps per profile. `full` and `browser` run after `quick`; together they cover the CI scripts. */
export const checkProfiles: Record<CheckProfile, CheckStep[]> = {
  quick: [
    { script: 'format:check' },
    { script: 'lint' },
    { script: 'typecheck' },
    { script: 'quick:test' },
    { script: 'build' },
    { script: 'test:built-exports' },
  ],
  full: [
    { script: 'test:pg' },
    { script: 'test:coverage' },
    { script: 'test:recipe', args: ['--database=sqlite'] },
    { script: 'test:demo' },
    { script: 'docs:build' },
    { script: 'pack:fixture' },
    { script: 'test:consumer', args: ['--database=sqlite'] },
    {
      script: 'test:account-kit',
      args: ['--profile=all', '--database=sqlite', '--strategy=all', '--session-management=all'],
    },
  ],
  browser: [
    {
      script: 'test:account-kit-demo',
      env: { DB_CLIENT: 'sqlite', HOST: '127.0.0.1', PORT: '3398', SESSION_DRIVER: 'database' },
    },
    {
      script: 'test:browser',
      directory: 'examples/native-session',
      env: { ...browserEnv, PORT: '3391' },
    },
    { script: 'test:inertia-react', env: { ...browserEnv, PORT: '3393' } },
    { script: 'test:inertia-vue', env: { ...browserEnv, PORT: '3378' } },
  ],
}

export function selectedSteps(flags: string[]): CheckStep[] {
  const unknown = flags.filter((flag) => !['--full', '--browser'].includes(flag))
  if (unknown.length > 0) throw new Error(`Use pnpm check [--full] [--browser]; got ${unknown}`)
  return [
    ...checkProfiles.quick,
    ...(flags.includes('--full') ? checkProfiles.full : []),
    ...(flags.includes('--browser') ? checkProfiles.browser : []),
  ]
}
