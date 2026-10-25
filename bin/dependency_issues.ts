/**
 * Opens or updates one issue per minor or major dependency update. Dependabot opens pull
 * requests for patch updates only; see `.github/dependabot.yml`. Needs `gh` with `issues: write`.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  actionUpdate,
  type DependencyUpdate,
  githubReleases,
  type OpenIssue,
  planIssues,
  updateLevel,
} from './helpers/dependency_updates.js'

const label = 'dependencies'
const workflows = '.github/workflows'

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function npmUpdates(): DependencyUpdate[] {
  // `pnpm outdated` exits 1 when anything is outdated.
  const result = spawnSync('pnpm', ['outdated', '--format', 'json'], { encoding: 'utf8' })
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr)
  const outdated: Record<string, { current: string; latest: string }> = JSON.parse(
    result.stdout || '{}'
  )
  return Object.entries(outdated)
    .filter(([, { current, latest }]) => {
      const level = updateLevel(current, latest)
      return level === 'minor' || level === 'major'
    })
    .map(([name, { current, latest }]) => ({
      name,
      ecosystem: 'npm' as const,
      current,
      latest,
      releaseNotes: githubReleases(run('npm', ['view', name, 'repository.url']) || undefined),
    }))
}

function actionUpdates(): DependencyUpdate[] {
  const pins = new Map<string, string>()
  for (const file of readdirSync(workflows)) {
    const source = readFileSync(join(workflows, file), 'utf8')
    for (const match of source.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)(?:\/[^@\s]*)?@(v\d[\w.]*)/g)) {
      if (!pins.has(match[1])) pins.set(match[1], match[2])
    }
  }
  return [...pins].flatMap(([name, pin]) => {
    try {
      const latest = run('gh', ['api', `repos/${name}/releases/latest`, '--jq', '.tag_name'])
      return actionUpdate(name, pin, latest) ?? []
    } catch {
      console.warn(`No latest release found for ${name}; skipped`)
      return []
    }
  })
}

const open: OpenIssue[] = JSON.parse(
  run('gh', [
    'issue',
    'list',
    '--label',
    label,
    '--state',
    'open',
    '--limit',
    '200',
    '--json',
    'number,title,body',
  ])
)

for (const action of planIssues([...npmUpdates(), ...actionUpdates()], open)) {
  const fields = ['--title', action.title, '--body', action.body]
  if (action.kind === 'create') run('gh', ['issue', 'create', '--label', label, ...fields])
  else run('gh', ['issue', 'edit', String(action.number), ...fields])
  console.log(`${action.kind}: ${action.title}`)
}
