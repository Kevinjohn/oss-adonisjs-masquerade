import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { isKitVersionedDoc, staleKitVersions } from '../../bin/helpers/account_kit_bump.ts'
import { repoRoot, trackedMarkdown } from '../helpers/tracked_markdown.ts'

const peerName = '@kevinjohn/adonisjs-account-kit'

async function read(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8')
}

test('the changelog and maintainer records name the declared Account Kit peer', async ({
  assert,
}) => {
  const manifest = JSON.parse(await read('package.json'))
  const peer: string = manifest.peerDependencies[peerName]
  assert.isString(peer)

  const changelog = await read('CHANGELOG.md')
  assert.include(changelog.replace(/\s+/g, ' '), `Require Account Kit \`${peer}\` exactly.`)

  const conventions = await read('docs/maintainers/conventions.md')
  assert.include(conventions.replace(/\s+/g, ' '), `pinned to GitHub release artifact \`${peer}\``)

  const ledger = await read('docs/maintainers/requirement-ledger.md')
  const status = ledger.match(/^\*\*Matrix status:\*\*[\s\S]*?(?=\n\n)/m)?.[0] ?? ''
  assert.include(status.replace(/\s+/g, ' '), `\`${peerName}\` \`${peer}\` only`)
})

test('user-facing pages name only the declared Account Kit peer', async ({ assert }) => {
  const manifest = JSON.parse(await read('package.json'))
  const peer: string = manifest.peerDependencies[peerName]

  const stale: string[] = []
  for (const path of trackedMarkdown(['docs/guide/*.md', 'README*.md']).filter(isKitVersionedDoc)) {
    for (const { line, version } of staleKitVersions(await read(path), peer)) {
      stale.push(`${path}:${line} names Account Kit ${version}`)
    }
  }
  assert.deepEqual(stale, [])
})
