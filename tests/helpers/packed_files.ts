import { spawnSync } from 'node:child_process'
import { repoRoot } from './tracked_markdown.js'

/** Paths `pnpm pack` would put in the package tarball. */
export function packedFiles(): string[] {
  const pack = spawnSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (pack.status !== 0) throw new Error(pack.stderr)
  return (JSON.parse(pack.stdout) as { files: { path: string }[] }).files.map((file) => file.path)
}
