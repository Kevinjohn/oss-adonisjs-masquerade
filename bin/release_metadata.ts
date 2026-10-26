/** Validate the immutable release identity and read its handwritten notes without side effects. */
export function releaseMetadata(ref: string, version: string, changelog: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('The package version must be an explicit alpha prerelease')
  }
  const tag = `v${version}`
  if (ref !== `refs/tags/${tag}`) throw new Error('Dispatch must select the package version tag')
  const [, heading, body] = changelog.split(/^## (.+)$/m)
  if (heading !== version)
    throw new Error('The first changelog heading must match the package version')
  const notes = body?.trim()
  if (!notes) throw new Error('The release must contain handwritten notes')
  return { tag, notes: `${notes}\n` }
}

/** The Git reader is injected so identity failures can be tested without creating tags. */
export function releaseSource(
  ref: string,
  version: string,
  changelog: string,
  sha: string,
  git: (...args: string[]) => string
) {
  const metadata = releaseMetadata(ref, version, changelog)
  if (git('cat-file', '-t', metadata.tag) !== 'tag') {
    throw new Error('The version tag must be annotated')
  }
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    git('rev-parse', 'HEAD') !== sha ||
    git('rev-parse', `${metadata.tag}^{commit}`) !== sha
  ) {
    throw new Error('The selected tag, checked-out commit and workflow SHA must match')
  }
  git('merge-base', '--is-ancestor', sha, 'origin/main')
  if (git('status', '--porcelain')) throw new Error('The release checkout must be clean')
  return metadata
}
