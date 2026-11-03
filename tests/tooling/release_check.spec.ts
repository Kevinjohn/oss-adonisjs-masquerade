import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { repoRoot } from '../helpers/tracked_markdown.js'

test('released changelog headings use the form bin/release_check.sh requires', async ({
  assert,
}) => {
  const changelog = await readFile(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  const headings = [...changelog.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading)
  const released = headings.filter((heading) => heading !== 'Unreleased')
  assert.isAbove(released.length, 0)
  assert.deepEqual(
    released.filter((heading) => !/^\S+ - \d{4}-\d{2}-\d{2}$/.test(heading)),
    []
  )
})

/** Run the release gate in a throwaway package with the given changelog. */
async function releaseCheck(changelog: string) {
  const directory = await mkdtemp(join(tmpdir(), 'masquerade_release_check_'))
  try {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'release-fixture', version: '9.9.9', scripts: { build: 'true' } })
    )
    await writeFile(join(directory, 'CHANGELOG.md'), changelog)
    const environment: NodeJS.ProcessEnv = { ...process.env, GITHUB_REPOSITORY: 'owner/repo' }
    delete environment.GITHUB_ENV
    return spawnSync('bash', [join(repoRoot, 'bin/release_check.sh')], {
      cwd: directory,
      encoding: 'utf8',
      env: environment,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('release gate accepts an empty Unreleased section above the released version', async ({
  assert,
}) => {
  const result = await releaseCheck(
    '# Changelog\n\n## Unreleased\n\n## 9.9.9 - 2026-01-01\n\n- A\n'
  )
  assert.equal(result.status, 0, result.stderr)
  assert.include(result.stdout, 'ready: v9.9.9')
})

test('release gate refuses entries under Unreleased, which the tarball would ship', async ({
  assert,
}) => {
  const result = await releaseCheck(
    '# Changelog\n\n## Unreleased\n\n- Later change\n\n## 9.9.9 - 2026-01-01\n\n- A\n'
  )
  assert.notEqual(result.status, 0)
  assert.include(result.stderr, "entries under '## Unreleased'")
})
