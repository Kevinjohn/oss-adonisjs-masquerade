import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { releaseSource } from './release_metadata.js'

const root = new URL('../', import.meta.url)
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const { tag, notes } = releaseSource(
  process.env.GITHUB_REF ?? '',
  manifest.version,
  readFileSync(new URL('CHANGELOG.md', root), 'utf8'),
  process.env.GITHUB_SHA ?? '',
  git
)
mkdirSync(new URL('tmp/', root), { recursive: true })
writeFileSync(new URL('tmp/release_notes.md', root), notes)
console.log(`Validated ${tag} at ${process.env.GITHUB_SHA}; handwritten notes prepared`)
