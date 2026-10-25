/** Turns minor and major dependency updates into issues; Dependabot only opens patch PRs. */
export type UpdateLevel = 'patch' | 'minor' | 'major'

export interface DependencyUpdate {
  name: string
  ecosystem: 'npm' | 'github-actions'
  current: string
  latest: string
  releaseNotes?: string
}

export interface OpenIssue {
  number: number
  title: string
  body: string
}

export type IssueAction =
  | { kind: 'create'; title: string; body: string }
  | { kind: 'edit'; number: number; title: string; body: string }

const adonisScopes = ['@adonisjs/', '@japa/', '@poppinss/']

function versionParts(version: string): number[] {
  const [major = 0, minor = 0, patch = 0] = version
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  return [major, minor, patch]
}

/** Level of the move from `current` to `latest`, or undefined when `latest` is not newer. */
export function updateLevel(current: string, latest: string): UpdateLevel | undefined {
  const [fromMajor, fromMinor, fromPatch] = versionParts(current)
  const [toMajor, toMinor, toPatch] = versionParts(latest)
  if (toMajor !== fromMajor) return toMajor > fromMajor ? 'major' : undefined
  // Under semver a 0.x minor may break the API, so it is a major move.
  if (toMinor !== fromMinor)
    return toMinor > fromMinor ? (toMajor === 0 ? 'major' : 'minor') : undefined
  return toPatch > fromPatch ? 'patch' : undefined
}

function marker(update: DependencyUpdate): string {
  return `<!-- dependency-update: ${update.ecosystem}:${update.name} -->`
}

function reasonFor(update: DependencyUpdate, level: UpdateLevel): string {
  if (update.ecosystem === 'github-actions') {
    return 'A new major of a GitHub Action can change its inputs or its runtime. Check the release notes, then update every workflow that uses it.'
  }
  if (level === 'major' && versionParts(update.current)[0] === 0) {
    return 'Under semver a `0.x` minor release may break the API, so this is treated as a major update. Check the release notes for breaking changes before moving.'
  }
  if (level === 'major') {
    return 'A major release can break the API. The update policy raises majors by hand, alongside an AdonisJS major.'
  }
  if (adonisScopes.some((scope) => update.name.startsWith(scope))) {
    return 'AdonisJS released a new minor. The update policy follows AdonisJS minors, so move to it once the release notes are checked.'
  }
  return 'A third-party minor. The update policy moves third-party minors by hand when AdonisJS moves, for example once the AdonisJS starter kits adopt it.'
}

/** The issue for a minor or major update; patch updates stay with Dependabot. */
export function issueFor(update: DependencyUpdate): { title: string; body: string } | undefined {
  const level = updateLevel(update.current, update.latest)
  if (level === undefined || level === 'patch') return undefined
  const notes =
    update.releaseNotes ?? "No release notes link found; check the package's repository."
  return {
    title: `Update ${update.name} from ${update.current} to ${update.latest}`,
    body: [
      marker(update),
      `- Ecosystem: ${update.ecosystem}`,
      `- Update: ${level}, ${update.current} → ${update.latest}`,
      '',
      '## Why this is an issue',
      '',
      'Dependabot opens pull requests for patch updates only. Minor and major updates are reviewed by hand.',
      '',
      '## Reason',
      '',
      reasonFor(update, level),
      '',
      '## Release notes',
      '',
      notes,
      '',
    ].join('\n'),
  }
}

/** One open issue per dependency: create it, or edit it when a newer version appears. */
export function planIssues(updates: DependencyUpdate[], open: OpenIssue[]): IssueAction[] {
  return updates.flatMap((update): IssueAction[] => {
    const issue = issueFor(update)
    if (!issue) return []
    const existing = open.find((candidate) => candidate.body.includes(marker(update)))
    if (!existing) return [{ kind: 'create', ...issue }]
    if (existing.title === issue.title && existing.body === issue.body) return []
    return [{ kind: 'edit', number: existing.number, ...issue }]
  })
}

/** Action pins pinned to a major tag (`v6`) follow its minors, so only a new major counts. */
export function actionUpdate(
  name: string,
  pin: string,
  latest: string
): DependencyUpdate | undefined {
  const pinnedMajorOnly = /^v?\d+$/.test(pin)
  const level = updateLevel(pin, latest)
  if (level === undefined || level === 'patch') return undefined
  if (pinnedMajorOnly && versionParts(latest)[0] <= versionParts(pin)[0]) return undefined
  return {
    name,
    ecosystem: 'github-actions',
    current: pin,
    latest,
    releaseNotes: `https://github.com/${name}/releases/tag/${latest}`,
  }
}

/** The GitHub releases page for an npm package's `repository.url`, when it is on GitHub. */
export function githubReleases(repositoryUrl: string | undefined): string | undefined {
  const match = repositoryUrl?.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#/].*)?$/)
  return match ? `https://github.com/${match[1]}/${match[2]}/releases` : undefined
}
