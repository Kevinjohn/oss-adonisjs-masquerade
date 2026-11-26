import { test } from '@japa/runner'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { consumerArtifact, type PnpmScript } from '../bin/helpers/consumer_artifact.ts'

async function withRoot(callback: (root: string) => void | Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'consumer-artifact-'))
  try {
    await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test.group('consumerArtifact', () => {
  test('rebuilds and repacks before returning the fixture tarball', async ({ assert }) => {
    await withRoot((root) => {
      const calls: string[] = []
      const artifact = consumerArtifact(root, undefined, (_root, script) => calls.push(script))
      assert.deepEqual(calls, ['build', 'pack:fixture'])
      assert.equal(artifact, join(root, 'tmp/native-session-package.tgz'))
    })
  })

  test('stops before packing when the build fails', async ({ assert }) => {
    await withRoot((root) => {
      const calls: string[] = []
      const failingBuild: PnpmScript = (_root, script) => {
        calls.push(script)
        if (script === 'build') throw new Error('lint failed')
      }
      assert.throws(() => consumerArtifact(root, undefined, failingBuild), 'lint failed')
      assert.deepEqual(calls, ['build'])
    })
  })

  test('uses an explicit package as given without rebuilding', async ({ assert }) => {
    await withRoot((root) => {
      const calls: string[] = []
      const artifact = consumerArtifact(root, 'baselines/alpha.tgz', (_root, script) =>
        calls.push(script)
      )
      assert.deepEqual(calls, [])
      assert.equal(artifact, join(root, 'baselines/alpha.tgz'))
    })
  })
})
