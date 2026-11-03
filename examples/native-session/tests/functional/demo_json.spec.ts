import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import { setMasqueradeStoreUnavailable } from '#services/masquerade_fixture_boundary'

test.group('same-origin JSON support client', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(async () => {
    setMasqueradeStoreUnavailable(false)
    await limiter.clear(['memory'])
    await cleanUsers()
  })

  test('serves a raw shell and reads effective customer data while keeping the raw actor', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    target.email = 'customer-one@example.test'
    await target.save()
    const shell = await client.get('/support/json').header('Accept', 'text/html').loginAs(actor)
    shell.assertStatus(200)
    assert.include(shell.text(), 'id="json-client"')
    assert.include(shell.text(), target.email)
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({
        targetId: String(target.id),
        reason: 'JSON customer read',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    const customer = await client
      .get('/support/json/customer')
      .header('Accept', 'application/json')
      .loginAs(actor)
    customer.assertStatus(200)
    assert.equal(customer.body().actor.id, actor.id)
    assert.equal(customer.body().customer.id, target.id)
    assert.equal(customer.body().mode.access, 'view')
    assert.equal(customer.body().mode.contextToken, started.body().contextToken)
    assert.equal(customer.body().emailUpdates, false)
    customer.assertHeader('cache-control', 'private, no-store')
  })

  test('requires current business context before changing the preference', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({
        targetId: String(target.id),
        reason: 'JSON mutation',
        access: 'edit',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    const token = started.body().contextToken as string
    const missing = await client
      .post('/support/json/customer/preference')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ emailUpdates: '1' })
      .loginAs(actor)
    missing.assertStatus(428)
    const stale = await client
      .post('/support/json/customer/preference')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', idle.body().contextToken)
      .json({ emailUpdates: '1' })
      .loginAs(actor)
    stale.assertStatus(409)
    assert.isNull(await db.from('demo_preferences').where('user_id', target.id).first())
    const saved = await client
      .post('/support/json/customer/preference')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', token)
      .json({ emailUpdates: '1' })
      .loginAs(actor)
    saved.assertStatus(200)
    assert.equal(saved.body().emailUpdates, true)
    const preference = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(preference?.email_updates, 1)
  })

  test('uses the customer ability and blocks sensitive actions without mutation', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    actor.canMutate = true
    target.canMutate = false
    await actor.save()
    await target.save()
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({
        targetId: String(target.id),
        reason: 'Customer permission',
        access: 'edit',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    const token = started.body().contextToken as string
    const customer = await client
      .get('/support/json/customer')
      .header('Accept', 'application/json')
      .loginAs(actor)
    customer.assertStatus(200)
    assert.equal(customer.body().canEdit, false)
    const denied = await client
      .post('/support/json/customer/preference')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', token)
      .json({ emailUpdates: '1' })
      .loginAs(actor)
    denied.assertStatus(403)
    const sensitive = await client
      .post('/support/json/customer/sensitive')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', token)
      .json({})
      .loginAs(actor)
    sensitive.assertStatus(403)
    assert.isNull(await db.from('demo_preferences').where('user_id', target.id).first())
  })

  test('keeps raw status and stop reachable after effective admission fails', async ({
    client,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({
        targetId: String(target.id),
        reason: 'JSON recovery',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    target.active = false
    await target.save()
    const denied = await client
      .get('/support/json/customer')
      .header('Accept', 'application/json')
      .loginAs(actor)
    denied.assertStatus(409)
    const raw = await client.get('/masquerade').header('Accept', 'application/json').loginAs(actor)
    raw.assertStatus(200)
    const stop = await client
      .post('/masquerade/stop')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ _masqueradeContext: raw.body().contextToken })
      .loginAs(actor)
    stop.assertStatus(200)
  })
})
