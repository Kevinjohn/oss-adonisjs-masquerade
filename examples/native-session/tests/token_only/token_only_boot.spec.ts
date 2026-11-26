import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import { cleanUsers, createAccessToken, createUsers } from '#tests/helpers/users'

test.group('token-only native authority boot', (group) => {
  function status(client: ApiClient, token: string) {
    return client.get('/api/masquerade').header('Authorization', `Bearer ${token}`)
  }

  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanUsers())

  test('boots with the token guard as default and completes a real HTTP journey', async ({
    client,
    assert,
  }) => {
    assert.equal(process.env.MASQUERADE_TRANSPORT, 'tokens')
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)

    const idle = await status(client, value)
    idle.assertStatus(200)
    const started = await client
      .post('/api/masquerade/start')
      .header('Authorization', `Bearer ${value}`)
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', idle.body().contextToken)
      .json({ targetId: target.id, reason: 'token-only boot journey' })
    started.assertStatus(200)

    const business = await client.get('/api/business').header('Authorization', `Bearer ${value}`)
    business.assertStatus(200)
    business.assertBodyContains({
      actorId: actor.id,
      effectiveId: target.id,
      getUserOrFailId: target.id,
      authenticatedViaGuard: 'api_effective',
      silentAuthSnapshot: { guard: 'api_effective', userId: target.id },
    })

    const stopped = await client
      .post('/api/masquerade/stop')
      .header('Authorization', `Bearer ${value}`)
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', started.body().contextToken)
      .json({})
    stopped.assertStatus(200)
    const after = await status(client, value)
    after.assertBodyContains({ isMasquerading: false })
  })
})
