import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { kitReleaseSha256, kitReleaseUrl } from './account_kit_host_wiring.ts'

export async function ensureKitArtifact(path: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (existsSync(path)) {
    const digest = createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
    if (digest === kitReleaseSha256) return
    throw new Error(
      `Cached Account Kit release has a SHA-256 mismatch: ${path}. Inspect it manually.`
    )
  }
  const response = await fetch(kitReleaseUrl, {
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]),
  })
  if (!response.ok)
    throw new Error(`Account Kit release download failed with HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  signal?.throwIfAborted()
  if (createHash('sha256').update(bytes).digest('hex') !== kitReleaseSha256)
    throw new Error('Account Kit release SHA-256 mismatch')
  const temporary = `${path}.download`
  await writeFile(temporary, bytes)
  await rename(temporary, path)
}
