/**
 * Moves this repository to another Account Kit release: `pnpm bump:account-kit 0.3.5`.
 *
 * It downloads the current and target release tarballs, then rewrites every tracked reference:
 * release URLs and tarball names, the exact peer, lockfile integrity and versions, the release
 * SHA-256 and source commit, and version mentions in code and docs. `CHANGELOG.md` and the
 * requirement ledger's pin history stay as written; the script lists the lines that still name the
 * old version so they can be updated by hand.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  type KitRelease,
  kitPackage,
  kitReleaseUrl,
  kitRepository,
  rewriteFor,
} from './helpers/account_kit_bump.js'

const run = promisify(execFile)

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

async function fetchRelease(version: string): Promise<KitRelease> {
  const url = kitReleaseUrl(version)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Cannot download ${url}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())

  const refs = await git([
    'ls-remote',
    kitRepository,
    `refs/tags/v${version}`,
    `refs/tags/v${version}^{}`,
  ])
  const lines = refs.trim().split('\n').filter(Boolean)
  const line = lines.find((entry) => entry.endsWith('^{}')) ?? lines[0]
  if (!line) throw new Error(`Account Kit has no tag v${version}`)

  return {
    version,
    url,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    revision: line.split('\t')[0],
  }
}

const target = process.argv[2]
if (!target || !/^\d+\.\d+\.\d+$/.test(target)) {
  console.error('Usage: pnpm bump:account-kit <version>')
  process.exit(1)
}

const topLevel = await git(['rev-parse', '--show-toplevel'])
const root = topLevel.trim()
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const current: unknown = manifest.peerDependencies?.[kitPackage]
if (typeof current !== 'string' || !/^\d+\.\d+\.\d+$/.test(current)) {
  console.error(`package.json does not pin ${kitPackage} to an exact version.`)
  process.exit(1)
}
if (current === target) {
  console.log(`Already on Account Kit ${target}.`)
  process.exit(0)
}
if (manifest.version === current || manifest.version === target) {
  console.error(
    `This package's own version ${manifest.version} matches an Account Kit version; rewrite by hand.`
  )
  process.exit(1)
}

const [from, to] = await Promise.all([fetchRelease(current), fetchRelease(target)])

const changed: string[] = []
const tracked = await git(['ls-files', '-z'], root)
for (const path of tracked.split('\0').filter(Boolean)) {
  const rewrite = rewriteFor(path)
  if (!rewrite) continue
  const file = join(root, path)
  const bytes = await readFile(file).catch(() => undefined)
  if (!bytes || bytes.includes(0)) continue
  const text = bytes.toString('utf8')
  const next = rewrite(text, from, to)
  if (next !== text) {
    await writeFile(file, next)
    changed.push(path)
  }
}

console.log(`Account Kit ${from.version} -> ${to.version}`)
console.log(`  SHA-256  ${to.sha256}`)
console.log(`  commit   ${to.revision}`)
console.log(`Rewrote ${changed.length} files.`)

const oldVersion = `(^|[^0-9.])${from.version.replaceAll('.', '\\.')}([^0-9]|$)`
const leftovers = await git(
  [
    'grep',
    '-n',
    '-E',
    oldVersion,
    '--',
    '.',
    ':(exclude,glob)**/CHANGELOG.md',
    ':(exclude,glob)**/pnpm-lock.yaml',
  ],
  root
).catch(() => '')
if (leftovers) {
  console.log(`\nStill naming ${from.version} (update by hand where it is not history):`)
  console.log(leftovers.trimEnd())
}
console.log('\nAdd the changelog entry and any pin history notes, then run pnpm check.')
