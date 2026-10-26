import { readFileSync } from 'node:fs'

// The first handwritten entry is the pending release, whether still Unreleased or versioned.
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const entry = changelog.split(/^## .+$/m)[1]?.trim()
if (!entry) throw new Error('The first changelog entry must contain release notes')
process.stdout.write(`${entry}\n`)
