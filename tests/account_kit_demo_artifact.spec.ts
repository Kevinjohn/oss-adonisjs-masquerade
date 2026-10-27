import { test } from '@japa/runner'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureKitArtifact } from '../bin/helpers/account_kit_demo_artifact.js'

test('rejects a corrupt cached pinned artifact without changing it', async ({ assert }) => {
  const directory = await mkdtemp(join(tmpdir(), 'account-kit-artifact-'))
  const artifact = join(directory, 'account-kit-0.1.3.tgz')
  try {
    await writeFile(artifact, 'wrong artifact')
    await assert.rejects(() => ensureKitArtifact(artifact), /SHA-256 mismatch/)
    assert.equal(await readFile(artifact, 'utf8'), 'wrong artifact')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
