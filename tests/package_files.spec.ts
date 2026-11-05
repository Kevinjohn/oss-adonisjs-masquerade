import { test } from '@japa/runner'
import { packedFiles } from './helpers/packed_files.js'

const rootFiles = [
  'package.json',
  'README.md',
  'README-AGENTS.md',
  'LICENSE.md',
  'CHANGELOG.md',
  'SECURITY.md',
]

if (process.env.TEST_BUILT_EXPORTS === '1') {
  test('packs only build output and the root release documents', ({ assert }) => {
    const files = packedFiles()
    const unexpected = files.filter(
      (path) =>
        !rootFiles.includes(path) &&
        !(path.startsWith('build/') && !/^build\/(bin|tests)\//.test(path))
    )
    assert.deepEqual(unexpected, [])
    for (const path of rootFiles) assert.include(files, path)
    assert.include(files, 'build/index.js')
    assert.include(files, 'build/stubs/migrations/create_masquerade_tables.stub')
  })
}
