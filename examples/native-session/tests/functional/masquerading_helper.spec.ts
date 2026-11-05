import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { cleanUsers, createUsers } from '#tests/helpers/users'

test.group('masquerading() API client helper', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanUsers())

  test('runs the request as the target and ends the mode afterwards', async ({ client }) => {
    const { actor, target } = await createUsers()
    const masquerading = await client
      .get('/business')
      .loginAs(actor)
      .masquerading(target, { access: 'view' })
    masquerading.assertStatus(200)
    masquerading.assertBodyContains({ effectiveId: target.id, rawActorId: actor.id })

    const after = await client.get('/business').loginAs(actor)
    after.assertBodyContains({ effectiveId: actor.id, rawActorId: actor.id })
  })

  test('sends the context token, so an edit mode reaches an allowed mutation', async ({
    client,
  }) => {
    const { actor, target } = await createUsers()
    const allowed = await client
      .post('/business/mutate')
      .json({})
      .withCsrfToken()
      .loginAs(actor)
      .masquerading(target, { access: 'edit', reason: 'Ticket 42' })
    allowed.assertStatus(200)
    allowed.assertBodyContains({ ran: true, effectiveId: target.id, rawActorId: actor.id })
  })

  test('a view-only mode cannot mutate', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const denied = await client
      .post('/business/mutate')
      .json({})
      .withCsrfToken()
      .loginAs(actor)
      .masquerading(target, { access: 'view' })
    denied.assertStatus(403)
    assert.deepInclude(denied.body().errors[0], {
      code: 'E_MASQUERADE_ACTION_BLOCKED',
      blockedBy: 'view_only',
    })
  })

  test('a sensitive route is blocked even in edit mode', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const denied = await client
      .post('/business/billing')
      .json({})
      .withCsrfToken()
      .loginAs(actor)
      .masquerading(target, { access: 'edit', reason: 'Ticket 42' })
    denied.assertStatus(403)
    assert.deepInclude(denied.body().errors[0], {
      code: 'E_MASQUERADE_ACTION_BLOCKED',
      blockedBy: 'sensitive',
    })
  })

  test('a policy denial fails the request setup instead of running it unmasked', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    await assert.rejects(async () => {
      await client.get('/business').loginAs(target).masquerading(actor, { access: 'view' })
    }, /masquerading\(\) start control returned 403/)
  })

  test('an operator cannot start a mode for another operator', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    target.masqueradeOperator = true
    await target.save()
    await assert.rejects(async () => {
      await client.get('/business').loginAs(actor).masquerading(target, { access: 'view' })
    }, /masquerading\(\) start control returned 403/)
  })
})
