/**
 * Opens or updates one issue per minor or major dependency update. Dependabot opens pull
 * requests for patch updates only; see `.github/dependabot.yml`. Needs `gh` with `issues: write`.
 */
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
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
      releaseNotes: githubReleases(run('pnpm', ['view', name, 'repository.url']) || undefined),
    }))
}

interface ActionReleaseResponse {
  status: number
  body: string
}

function parseActionReleaseResponse(output: string): ActionReleaseResponse {
  const statusLine = output.match(/^HTTP\/(?:1\.[01]|2(?:\.0)?)\s+(\d{3})(?:\s|$)/)
  const separator = output.match(/\r?\n\r?\n/)
  if (!statusLine || !separator || separator.index === undefined) {
    throw new Error('GitHub CLI returned a malformed HTTP response')
  }

  return {
    status: Number(statusLine[1]),
    body: output.slice(separator.index + separator[0].length),
  }
}

function commandFailure(name: string, result: SpawnSyncReturns<string>, status?: number): Error {
  const details = [
    status === undefined ? undefined : `HTTP ${status}`,
    result.signal ? `signal ${result.signal}` : undefined,
    result.status === null ? 'no process exit status' : `exit ${result.status}`,
    result.error?.message,
    result.stderr?.trim(),
  ].filter(Boolean)

  return new Error(
    `Unable to read latest release for ${name}${details.length ? `: ${details.join('; ')}` : ''}`
  )
}

function latestActionRelease(name: string): string | undefined {
  const result = spawnSync('gh', ['api', `repos/${name}/releases/latest`, '--include'], {
    encoding: 'utf8',
  })

  if (result.error || result.signal || result.status === null) {
    throw commandFailure(name, result)
  }

  let response: ActionReleaseResponse
  try {
    response = parseActionReleaseResponse(result.stdout ?? '')
  } catch (error) {
    throw new Error(`${commandFailure(name, result).message}: ${error}`)
  }

  if (response.status === 404 && result.status !== 0) {
    const confirmation = spawnSync('gh', ['api', `repos/${name}/releases?per_page=1`, '--silent'], {
      encoding: 'utf8',
    })
    // A signal or spawn error leaves `status` null, so exit 0 alone proves the read succeeded.
    if (confirmation.status === 0) {
      console.warn(`No latest release found for ${name}; skipped`)
      return undefined
    }
    const confirmationFailure = commandFailure(name, confirmation)
    const latestFailure = [
      `latest endpoint returned HTTP ${response.status} with exit ${result.status}`,
      result.stderr?.trim(),
    ]
      .filter(Boolean)
      .join('; ')
    throw new Error(
      `Latest release lookup for ${name} returned HTTP ${response.status}, but release-list confirmation failed: ${confirmationFailure.message}; ${latestFailure}`
    )
  }

  if (result.status !== 0 || response.status !== 200) {
    throw commandFailure(name, result, response.status)
  }

  let release: unknown
  try {
    release = JSON.parse(response.body)
  } catch (error) {
    throw new Error(`Unable to parse latest release for ${name}: ${error}`)
  }
  if (
    typeof release !== 'object' ||
    release === null ||
    !('tag_name' in release) ||
    typeof release.tag_name !== 'string' ||
    release.tag_name.length === 0
  ) {
    throw new Error(`GitHub returned no valid tag_name for latest release of ${name}`)
  }
  return release.tag_name
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
    const latest = latestActionRelease(name)
    return latest === undefined ? [] : (actionUpdate(name, pin, latest) ?? [])
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
