import { test } from '@japa/runner'
import {
  type KitRelease,
  kitReleaseUrl,
  rewriteFor,
  rewriteLedger,
  rewriteLockfile,
  rewriteManifest,
  rewriteText,
} from '../../bin/helpers/account_kit_bump.js'

const from: KitRelease = {
  version: '0.3.3',
  url: kitReleaseUrl('0.3.3'),
  integrity: 'sha512-OLD==',
  sha256: 'a'.repeat(64),
  revision: 'b'.repeat(40),
}
const to: KitRelease = {
  version: '0.3.4',
  url: kitReleaseUrl('0.3.4'),
  integrity: 'sha512-NEW==',
  sha256: 'c'.repeat(64),
  revision: 'd'.repeat(40),
}

test.group('Account Kit bump', () => {
  test('rewrites the Account Kit entries of a lockfile and nothing else', ({ assert }) => {
    const lockfile = [
      'importers:',
      '  .:',
      '    devDependencies:',
      "      '@kevinjohn/adonisjs-account-kit':",
      `        specifier: ${from.url}`,
      `        version: ${from.url}(abc)`,
      'packages:',
      "  '@kevinjohn/adonisjs-access-control@0.1.7':",
      '    peerDependencies:',
      "      '@kevinjohn/adonisjs-account-kit': 0.3.3",
      `  '@kevinjohn/adonisjs-account-kit@${from.url}':`,
      `    resolution: {integrity: ${from.integrity}, tarball: ${from.url}}`,
      '    version: 0.3.3',
      "  'youch-core@0.3.3':",
      '    resolution: {integrity: sha512-KEEP==}',
      '    version: 0.3.3',
      '',
    ].join('\n')

    assert.equal(
      rewriteLockfile(lockfile, from, to),
      [
        'importers:',
        '  .:',
        '    devDependencies:',
        "      '@kevinjohn/adonisjs-account-kit':",
        `        specifier: ${to.url}`,
        `        version: ${to.url}(abc)`,
        'packages:',
        "  '@kevinjohn/adonisjs-access-control@0.1.7':",
        '    peerDependencies:',
        "      '@kevinjohn/adonisjs-account-kit': 0.3.4",
        `  '@kevinjohn/adonisjs-account-kit@${to.url}':`,
        `    resolution: {integrity: ${to.integrity}, tarball: ${to.url}}`,
        '    version: 0.3.4',
        "  'youch-core@0.3.3':",
        '    resolution: {integrity: sha512-KEEP==}',
        '    version: 0.3.3',
        '',
      ].join('\n')
    )
  })

  test('rewrites the exact peer and release URL of a manifest only', ({ assert }) => {
    const manifest = JSON.stringify(
      {
        version: '0.2.8',
        dependencies: { other: '0.3.3' },
        devDependencies: { '@kevinjohn/adonisjs-account-kit': from.url },
        peerDependencies: { '@kevinjohn/adonisjs-account-kit': '0.3.3' },
      },
      null,
      2
    )

    assert.deepEqual(JSON.parse(rewriteManifest(manifest, from, to)), {
      version: '0.2.8',
      dependencies: { other: '0.3.3' },
      devDependencies: { '@kevinjohn/adonisjs-account-kit': to.url },
      peerDependencies: { '@kevinjohn/adonisjs-account-kit': '0.3.4' },
    })
  })

  test('rewrites checksums, commits and plain or escaped versions in other files', ({ assert }) => {
    const source = [
      `export const kitReleaseSha256 = '${from.sha256}'`,
      `export const kitSourceRevision = '${from.revision}'`,
      "export const kitReleaseVersion = '0.3.3'",
      String.raw`assert.match(source, /releases\/download\/v0\.3\.3\//)`,
      String.raw`new RegExp('0\\.3\\.3')`,
      'Account Kit `0.3.3` at `v0.3.3`; youch 10.3.3 and 0.3.30 stay.',
    ].join('\n')

    assert.equal(
      rewriteText(source, from, to),
      [
        `export const kitReleaseSha256 = '${to.sha256}'`,
        `export const kitSourceRevision = '${to.revision}'`,
        "export const kitReleaseVersion = '0.3.4'",
        String.raw`assert.match(source, /releases\/download\/v0\.3\.4\//)`,
        String.raw`new RegExp('0\\.3\\.4')`,
        'Account Kit `0.3.4` at `v0.3.4`; youch 10.3.3 and 0.3.30 stay.',
      ].join('\n')
    )
  })

  test('rewrites the ledger matrix status but keeps the pin history', ({ assert }) => {
    const ledger = [
      '**Matrix status:** The optional peer declares `@kevinjohn/adonisjs-account-kit` `0.3.3` only.',
      'The `0.3.3` matrix runs in the update pull request.',
      '',
      'Account Kit `0.3.3` adds `admission.record`, SHA-256 `' + from.sha256 + '`.',
      '',
    ].join('\n')

    assert.equal(
      rewriteLedger(ledger, from, to),
      [
        '**Matrix status:** The optional peer declares `@kevinjohn/adonisjs-account-kit` `0.3.4` only.',
        'The `0.3.4` matrix runs in the update pull request.',
        '',
        'Account Kit `0.3.3` adds `admission.record`, SHA-256 `' + from.sha256 + '`.',
        '',
      ].join('\n')
    )
  })

  test('leaves changelogs alone and picks the rewrite by file', ({ assert }) => {
    assert.isUndefined(rewriteFor('CHANGELOG.md'))
    assert.strictEqual(rewriteFor('examples/api/pnpm-lock.yaml'), rewriteLockfile)
    assert.strictEqual(rewriteFor('examples/api/package.json'), rewriteManifest)
    assert.strictEqual(rewriteFor('docs/maintainers/requirement-ledger.md'), rewriteLedger)
    assert.strictEqual(rewriteFor('docs/guide/setup.md'), rewriteText)
  })
})
