import { test } from '@japa/runner'
import { hashSecurityStamp } from '../src/security_stamp.ts'

test('hashes opaque stamps with a512 UTF8 byte bound without storing plaintext', ({ assert }) => {
  assert.match(hashSecurityStamp('secret'), /^[a-f0-9]{64}$/)
  assert.equal(hashSecurityStamp('secret'), hashSecurityStamp('secret'))
  assert.notEqual(hashSecurityStamp('secret'), hashSecurityStamp('other'))
  assert.match(hashSecurityStamp('\u0000\r\nopaque'), /^[a-f0-9]{64}$/)
  assert.match(hashSecurityStamp('😀'.repeat(128)), /^[a-f0-9]{64}$/)
  for (const value of [
    '',
    undefined,
    ['secret'],
    'a'.repeat(513),
    '😀'.repeat(129),
    '\uD800',
    '\uDC00',
    'a\uD800b',
  ])
    assert.throws(() => hashSecurityStamp(value), 'Masquerade is unavailable')
})
