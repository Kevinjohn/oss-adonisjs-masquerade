import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const artifact = 'tmp/release_package.tgz'
const source = JSON.parse(readFileSync('package.json', 'utf8'))
const packed = JSON.parse(
  execFileSync('tar', ['-xOf', artifact, 'package/package.json'], { encoding: 'utf8' })
)
for (const field of ['name', 'version', 'exports', 'repository', 'publishConfig']) {
  assert.deepEqual(packed[field], source[field], `Packed ${field} must match the verified source`)
}
const files = execFileSync('tar', ['-tzf', artifact], { encoding: 'utf8' }).split('\n')
for (const file of [
  'build/index.js',
  'build/index.d.ts',
  'README.md',
  'LICENSE.md',
  'SECURITY.md',
  'CHANGELOG.md',
]) {
  assert.ok(files.includes(`package/${file}`), `Release archive is missing ${file}`)
}
assert.equal(
  execFileSync('tar', ['-xOf', artifact, 'package/CHANGELOG.md'], { encoding: 'utf8' }),
  readFileSync('CHANGELOG.md', 'utf8')
)
console.log(`Inspected ${artifact}: ${packed.name}@${packed.version}`)
