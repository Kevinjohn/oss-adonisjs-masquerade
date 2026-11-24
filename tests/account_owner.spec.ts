import { test } from '@japa/runner'
import { resolveAccountOwner, requireCanonicalId } from '../account_kit/account_owner.js'

const unavailable = { code: 'E_MASQUERADE_ACCOUNT_INCARNATION_INVALID' }

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
    assert.throws(
      () => requireCanonicalId(id),
      'The account provider returned an invalid identifier'
    )
  for (const incarnation of ['', 'x'.repeat(129)]) {
    try {
      resolveAccountOwner(() => incarnation, {}, 'a')
      assert.fail('accepted an unusable incarnation')
    } catch (error) {
      assert.containSubset(error, unavailable)
    }
  }
})
