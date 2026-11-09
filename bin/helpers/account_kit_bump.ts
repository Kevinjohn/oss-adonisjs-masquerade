/**
 * Text rewrites that move a checkout from one Account Kit release to another. Each function takes
 * the old and new release facts and returns the rewritten file text; `bin/bump_account_kit.ts`
 * fetches the facts and applies these to tracked files.
 */

export const kitPackage = '@kevinjohn/adonisjs-account-kit'
export const kitRepository = 'https://github.com/Kevinjohn/oss-adonisjs-account-kit'

export interface KitRelease {
  version: string
  url: string
  integrity: string
  sha256: string
  revision: string
}

export function kitReleaseUrl(version: string): string {
  return `${kitRepository}/releases/download/v${version}/kevinjohn-adonisjs-account-kit-${version}.tgz`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceAll(text: string, from: string, to: string): string {
  return text.split(from).join(to)
}

/**
 * Replaces a version written plainly (`0.3.3`), regex-escaped (`0\.3\.3`) or escaped inside a
 * string (`0\\.3\\.3`), without touching longer versions such as `10.3.3` or `0.3.30`.
 */
export function replaceVersion(text: string, from: string, to: string): string {
  let result = text
  for (const separator of ['.', '\\.', '\\\\.']) {
    const pattern = new RegExp(
      `(?<![\\d.])${escapeRegExp(from.split('.').join(separator))}(?!\\d)`,
      'g'
    )
    result = result.replace(pattern, () => to.split('.').join(separator))
  }
  return result
}

/** Rewrites the Account Kit URL, integrity, resolved version and peer specifier in a pnpm lockfile. */
export function rewriteLockfile(text: string, from: KitRelease, to: KitRelease): string {
  let result = replaceAll(text, from.url, to.url)
  result = replaceAll(result, from.integrity, to.integrity)
  result = replaceAll(
    result,
    `'${kitPackage}': ${from.version}\n`,
    `'${kitPackage}': ${to.version}\n`
  )
  const block = new RegExp(
    `(^  '${escapeRegExp(kitPackage)}@${escapeRegExp(to.url)}':\\n(?:    .*\\n)*?)    version: ${escapeRegExp(from.version)}\\n`,
    'gm'
  )
  return result.replace(block, (_match, head: string) => `${head}    version: ${to.version}\n`)
}

/** Rewrites the Account Kit release URL and exact peer in a package manifest. */
export function rewriteManifest(text: string, from: KitRelease, to: KitRelease): string {
  return replaceAll(
    replaceAll(text, from.url, to.url),
    `"${kitPackage}": "${from.version}"`,
    `"${kitPackage}": "${to.version}"`
  )
}

/**
 * Rewrites only the requirement ledger's matrix status paragraph. The pin history below it is
 * written by hand, because it records what each release changed.
 */
export function rewriteLedger(text: string, from: KitRelease, to: KitRelease): string {
  return text.replace(/^\*\*Matrix status:\*\*[\s\S]*?(?=\n\n)/m, (paragraph) =>
    replaceVersion(paragraph, from.version, to.version)
  )
}

/** Rewrites the release checksum, source commit and version mentions in any other file. */
export function rewriteText(text: string, from: KitRelease, to: KitRelease): string {
  let result = replaceAll(text, from.sha256, to.sha256)
  result = replaceAll(result, from.revision, to.revision)
  return replaceVersion(result, from.version, to.version)
}

/** Picks the rewrite for a tracked path, or `undefined` for files the bump leaves alone. */
export function rewriteFor(
  path: string
): ((text: string, from: KitRelease, to: KitRelease) => string) | undefined {
  const name = path.split('/').pop()
  if (name === 'CHANGELOG.md') return undefined
  if (name === 'pnpm-lock.yaml') return rewriteLockfile
  if (name === 'package.json') return rewriteManifest
  if (path === 'docs/maintainers/requirement-ledger.md') return rewriteLedger
  return rewriteText
}
