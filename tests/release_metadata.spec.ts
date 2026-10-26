import { test } from '@japa/runner'
import { releaseMetadata } from '../bin/release_metadata.js'

const version = '0.1.0-alpha.1'
const ref = `refs/tags/v${version}`

test('release metadata selects only the matching versioned handwritten entry', ({ assert }) => {
  assert.deepEqual(
    releaseMetadata(
      ref,
      version,
      `# Changelog\n\n## ${version}\n\n- First release.\n\n## Older\n\n- History.\n`
    ),
    { tag: `v${version}`, notes: '- First release.\n' }
  )
})

test('release metadata rejects branches, the alpha baseline tag and mismatched version tags', ({
  assert,
}) => {
  for (const selected of ['refs/heads/main', 'refs/tags/alpha-1', 'refs/tags/v0.1.0-alpha.2']) {
    assert.throws(() => releaseMetadata(selected, version, `## ${version}\n\nNotes`))
  }
})

test('release metadata rejects stable versions, malformed versions and unreviewed notes', ({
  assert,
}) => {
  for (const invalid of ['0.0.0', '0.1.0', '0.1.0-beta.1', '0.1.0-alpha.01', '0.1.0-alpha.1\n']) {
    assert.throws(() => releaseMetadata(`refs/tags/v${invalid}`, invalid, `## ${invalid}\n\nNotes`))
  }
  for (const changelog of [
    '## Unreleased\n\nNotes',
    '## 0.1.0-alpha.2\n\nNotes',
    `## ${version}\n\n`,
    '# Changelog',
  ]) {
    assert.throws(() => releaseMetadata(ref, version, changelog))
  }
})

test('release source rejects lightweight tags, mismatched commits, off-main source and dirty source', async ({
  assert,
}) => {
  const { releaseSource } = await import('../bin/release_metadata.js')
  const sha = 'a'.repeat(40)
  const changelog = `## ${version}\n\nNotes`
  const commands: string[][] = []
  const git = (...args: string[]) => {
    commands.push(args)
    if (args[0] === 'cat-file') return 'tag'
    if (args[0] === 'rev-parse') return sha
    return ''
  }
  assert.equal(releaseSource(ref, version, changelog, sha, git).tag, `v${version}`)
  assert.deepInclude(commands, ['merge-base', '--is-ancestor', sha, 'origin/main'])
  for (const failure of ['tag', 'head', 'peeled', 'ancestry', 'dirty']) {
    const failingGit = (...args: string[]) => {
      if (failure === 'tag' && args[0] === 'cat-file') return 'commit'
      if (failure === 'head' && args[1] === 'HEAD') return 'b'.repeat(40)
      if (failure === 'peeled' && args[1]?.endsWith('^{commit}')) return 'b'.repeat(40)
      if (failure === 'ancestry' && args[0] === 'merge-base') throw new Error('Not on main')
      if (failure === 'dirty' && args[0] === 'status') return ' M package.json'
      return git(...args)
    }
    assert.throws(() => releaseSource(ref, version, changelog, sha, failingGit))
  }
})

test('release workflow validates source, builds, inspects, publishes the tarball and then creates the prerelease', async ({
  assert,
}) => {
  const { readFileSync } = await import('node:fs')
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8'
  )
  const commands = [
    'bin/prepare_release.ts',
    'run: pnpm build',
    'run: pnpm pack --out tmp/release_package.tgz',
    'bin/inspect_release_package.ts',
    'run: pnpm publish tmp/release_package.tgz',
    'run: gh release create',
  ]
  const positions = commands.map((command) => workflow.indexOf(command))
  assert.isTrue(positions.every((position) => position >= 0))
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions
  )
  assert.notMatch(workflow.split('permissions:')[0], /\n {2}(push|release):/)
  assert.include(workflow, 'ref: ${{ github.sha }}')
  assert.include(workflow, '--verify-tag --prerelease --notes-file tmp/release_notes.md')
  assert.notMatch(workflow, /NPM_TOKEN|pnpm version|git (commit|tag|push)|release-it/)
})
