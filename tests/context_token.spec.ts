import { test } from '@japa/runner'
import { buildContextToken, requireContext } from '../src/context_token.js'
import { errorCode, fixture } from './helpers/core.js'

test('absent tokens are deterministic and length-framed owner-bound', ({ assert }) => {
  const owner = fixture().owner
  const token = buildContextToken(owner, null)
  assert.equal(buildContextToken(owner, null), token)
  for (const alternative of [
    { ...owner, actorId: 'b' },
    { ...owner, namespace: 'other' },
    { ...owner, actorIncarnation: 'new' },
    { namespace: 'te', actorId: 'sta', actorIncarnation: 'a' },
  ])
    assert.notEqual(buildContextToken(alternative, null), token)
})

test('bounded malformed tokens require context while valid wrong owner tokens are stale', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const idle = await service.status({})
  for (const token of [
    '',
    'x',
    '01.' + 'a'.repeat(32),
    '-1.' + 'a'.repeat(32),
    '9007199254740992.' + 'a'.repeat(32),
    '0.' + 'a'.repeat(200),
  ]) {
    assert.equal(
      await errorCode(() =>
        service.start({}, { targetId: 'b', reason: 'case', expectedContext: token })
      ),
      'E_MASQUERADE_CONTEXT_REQUIRED'
    )
  }
  assert.throws(
    () => requireContext(buildContextToken({ ...f.owner, actorId: 'b' }, null), idle.contextToken),
    'Masquerade context changed'
  )
})

test('A to idle to A rotates nonce and never revives old tokens', async ({ assert }) => {
  const f = fixture()
  const service = await f.create()
  const first = await f.start(service)
  const idle = await service.stop({}, { expectedContext: first.contextToken })
  const second = await f.start(service)
  assert.notEqual(second.contextToken, first.contextToken)
  for (const token of [idle.contextToken, first.contextToken])
    assert.equal(
      await errorCode(() => service.stop({}, { expectedContext: token })),
      'E_MASQUERADE_CONTEXT_CHANGED'
    )
})
