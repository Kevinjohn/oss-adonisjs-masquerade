import assert from 'node:assert/strict'
import { test } from '@japa/runner'
import { selectRegistryVersion } from '../../bin/helpers/registry_version.js'

test('accepts a scalar stable version', () => {
  assert.equal(selectRegistryVersion('@adonisjs/core', '7.10.0'), '7.10.0')
})

test('selects the greatest stable version from shuffled results numerically', () => {
  assert.equal(selectRegistryVersion('@adonisjs/core', ['7.9.0', '7.10.0', '7.2.0']), '7.10.0')
  assert.equal(selectRegistryVersion('@adonisjs/core', ['7.2.0', '7.10.0', '7.9.0']), '7.10.0')
})

test('rejects an empty registry result with package context', () => {
  assert.throws(() => selectRegistryVersion('@adonisjs/core', []), /no versions.*@adonisjs\/core/i)
})

test('rejects malformed and non-string registry versions with package context', () => {
  for (const listed of ['7.10', 'stable', '', 7, null, ['7.9.0', undefined]]) {
    assert.throws(() => selectRegistryVersion('@adonisjs/core', listed), /@adonisjs\/core/)
  }
})

test('rejects prereleases, build metadata, leading zeros, and unsafe components', () => {
  for (const version of ['7.10.0-rc.1', '7.10.0+build.1', '07.10.0', '7.9007199254740992.0']) {
    assert.throws(() => selectRegistryVersion('@adonisjs/core', version), /@adonisjs\/core/)
  }
})
