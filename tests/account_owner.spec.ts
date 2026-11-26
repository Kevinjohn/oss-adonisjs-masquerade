import { test } from '@japa/runner'
import { resolveAccountOwner, requireCanonicalId } from '../src/account_kit/account_owner.ts'

const unavailable = { code: 'E_MASQUERADE_UNAVAILABLE' }

test('account owners use the canonical ID and the configured incarnation', ({ assert }) => {
  assert.deepEqual(resolveAccountOwner('id', {}, 7), { id: '7', incarnation: '7' })
  assert.deepEqual(resolveAccountOwner('id', {}, 7n), { id: '7', incarnation: '7' })
  assert.deepEqual(
    resolveAccountOwner((user: { epoch: string }) => user.epoch, { epoch: 'e2' }, 'a'),
    { id: 'a', incarnation: 'e2' }
  )
})

test('account owners fail closed on unusable IDs and incarnations', ({ assert }) => {
  for (const id of [1.5, Number.MAX_SAFE_INTEGER + 1, null, {}, '', 'x'.repeat(256)])
    assert.throws(() => requireCanonicalId(id), 'Masquerade is unavailable')
  for (const incarnation of ['', 'x'.repeat(129)]) {
    try {
      resolveAccountOwner(() => incarnation, {}, 'a')
      assert.fail('accepted an unusable incarnation')
    } catch (error) {
      assert.containSubset(error, unavailable)
    }
  }
})
