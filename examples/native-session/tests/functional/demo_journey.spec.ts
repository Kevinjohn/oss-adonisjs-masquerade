import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import { setMasqueradeStoreUnavailable } from '#services/masquerade_test_boundary'

test.group('support operator browser journey', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(async () => {
    setMasqueradeStoreUnavailable(false)
    await limiter.clear(['memory'])
    await cleanUsers()
  })

  test('view-only start blocks the edit and renders the host page', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({
        targetId: String(target.id),
        reason: 'Read-only customer review',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(302)

    const active = await client.get('/masquerade').loginAs(actor)
    assert.equal(active.body().access, 'view')
    const blocked = await client
      .post('/support/customer/preference')
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ emailUpdates: '1', _masqueradeContext: active.body().contextToken })
      .loginAs(actor)
    blocked.assertStatus(403)
    assert.include(blocked.text(), 'View-only support mode')
    assert.include(blocked.text(), 'cannot change it')
    assert.notInclude(blocked.text(), 'route configuration')
    assert.isNull(await db.from('demo_preferences').where('user_id', target.id).first())

    const customer = await client
      .get('/support/customer')
      .header('Accept', 'text/html')
      .loginAs(actor)
    customer.assertStatus(200)
    assert.include(customer.text(), 'View only')
    assert.include(customer.text(), 'Off')
    const stopped = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ _masqueradeContext: active.body().contextToken })
      .loginAs(actor)
    stopped.assertStatus(302)
    assert.deepEqual(stopped.flashMessage('masquerade'), {
      type: 'success',
      action: 'stopped',
    })
  })

  test('flashes a typed form error and returns to the host support page', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({
        targetId: String(target.id),
        reason: 'First request',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(302)

    const rejected = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({
        targetId: String(target.id),
        reason: 'Stale duplicate',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    rejected.assertStatus(302)
    assert.equal(rejected.header('location'), '/support')
    assert.deepEqual(rejected.flashMessage('masquerade'), {
      type: 'error',
      code: 'E_MASQUERADE_CONTEXT_CHANGED',
    })
  })

  test('renders raw control, customer read, reversible mutation and sensitive denial', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    target.email = 'customer-one@example.test'
    await target.save()

    const idle = await client.get('/masquerade').loginAs(actor)
    const idleToken = idle.body().contextToken as string
    const workspace = await client.get('/support').header('Accept', 'text/html').loginAs(actor)
    workspace.assertStatus(200)
    assert.include(workspace.text(), 'Choose a customer')
    assert.include(workspace.text(), target.email)
    assert.include(workspace.text(), idleToken)

    const start = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({
        targetId: String(target.id),
        reason: 'Customer request',
        access: 'edit',
        _masqueradeContext: idleToken,
      })
      .loginAs(actor)
    start.assertStatus(302)
    assert.equal(start.header('location'), '/support/customer')

    const active = await client.get('/masquerade').loginAs(actor)
    const activeToken = active.body().contextToken as string
    const customer = await client
      .get('/support/customer')
      .header('Accept', 'text/html')
      .loginAs(actor)
    customer.assertStatus(200)
    assert.include(customer.text(), 'Signed in as')
    assert.include(customer.text(), actor.fullName!)
    assert.include(customer.text(), target.email)
    assert.include(customer.text(), 'Email updates')
    assert.include(customer.text(), 'Off')
    assert.include(customer.text(), activeToken)
    assert.include(customer.text(), 'data-support-intent')

    const mutation = await client
      .post('/support/customer/preference')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ emailUpdates: '1', _masqueradeContext: activeToken })
      .loginAs(actor)
    mutation.assertStatus(302)
    const saved = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(saved?.email_updates, 1)

    const sensitive = await client
      .post('/support/customer/sensitive')
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ _masqueradeContext: activeToken })
      .loginAs(actor)
    sensitive.assertStatus(403)
    assert.include(sensitive.text(), 'Sensitive action blocked')
    const afterSensitive = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(afterSensitive?.email_updates, 1)

    const stop = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ _masqueradeContext: activeToken })
      .loginAs(actor)
    stop.assertStatus(302)
    assert.equal(stop.header('location'), '/support')

    const stale = await client
      .post('/support/customer/preference')
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ emailUpdates: '0', _masqueradeContext: activeToken })
      .loginAs(actor)
    stale.assertStatus(409)
    assert.include(stale.text(), 'Support context changed')
    const afterStale = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(afterStale?.email_updates, 1)
  })

  test('keeps raw status and stop available when the customer is invalid', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .form({
        targetId: String(target.id),
        reason: 'Recovery test',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    const activeToken = started.body().contextToken as string

    target.active = false
    await target.save()
    const control = await client.get('/support').header('Accept', 'text/html').loginAs(actor)
    control.assertStatus(200)
    assert.include(control.text(), 'Stop support mode')
    assert.include(control.text(), 'This customer is unavailable')
    assert.notInclude(control.text(), 'Review customer workspace')
    const stop = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ _masqueradeContext: activeToken })
      .loginAs(actor)
    stop.assertStatus(302)
  })

  test('keeps raw status and stop available after operator access is revoked', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .form({
        targetId: String(target.id),
        reason: 'Recovery after policy change',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    actor.masqueradeOperator = false
    await actor.save()

    const control = await client.get('/support').header('Accept', 'text/html').loginAs(actor)
    control.assertStatus(200)
    assert.include(control.text(), 'Operator access was removed')
    assert.include(control.text(), 'Stop support mode')
    assert.notInclude(control.text(), 'Review customer workspace')

    const stopped = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ _masqueradeContext: started.body().contextToken })
      .loginAs(actor)
    stopped.assertStatus(302)
  })

  test('recovers from a failed effective admission through raw status', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .form({
        targetId: String(target.id),
        reason: 'Admission test',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    target.active = false
    await target.save()

    const blocked = await client
      .get('/support/customer')
      .header('Accept', 'text/html')
      .loginAs(actor)
    blocked.assertStatus(409)
    assert.include(blocked.text(), 'Check current status')
    const control = await client.get('/support').header('Accept', 'text/html').loginAs(actor)
    control.assertStatus(200)
    assert.include(control.text(), 'Choose a customer')
  })

  test('uses customer permission instead of the operator permission', async ({
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
      .form({
        targetId: String(target.id),
        reason: 'Permission test',
        access: 'edit',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    const activeToken = started.body().contextToken as string
    const page = await client.get('/support/customer').header('Accept', 'text/html').loginAs(actor)
    page.assertStatus(200)
    assert.include(page.text(), 'This customer cannot change the preference.')
    const denied = await client
      .post('/support/customer/preference')
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ emailUpdates: '1', _masqueradeContext: activeToken })
      .loginAs(actor)
    denied.assertStatus(403)
    assert.isNull(await db.from('demo_preferences').where('user_id', target.id).first())
  })

  test('renders HTML recovery for unavailable status and limiter denial', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const token = idle.body().contextToken as string
    setMasqueradeStoreUnavailable(true)
    const unavailable = await client.get('/support').header('Accept', 'text/html').loginAs(actor)
    unavailable.assertStatus(503)
    assert.include(unavailable.text(), 'Check current status')
    setMasqueradeStoreUnavailable(false)

    // A start reason is optional, so an empty one is accepted; a control character is not.
    for (const fields of [
      { reason: 'Invalid\u0001reason' },
      { reason: 'Valid reason', unexpected: 'extra field' },
    ]) {
      const denied = await client
        .post('/support/start')
        .redirects(0)
        .withCsrfToken()
        .header('Accept', 'text/html')
        .form({ targetId: String(target.id), _masqueradeContext: token, ...fields })
        .loginAs(actor)
      denied.assertStatus(302)
      assert.equal(denied.header('location'), '/support')
      assert.deepEqual(denied.flashMessage('masquerade'), {
        type: 'error',
        code: 'E_MASQUERADE_INVALID_INPUT',
      })
    }
    const limited = await client
      .post('/support/start')
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ targetId: String(target.id), reason: '', _masqueradeContext: token })
      .loginAs(actor)
    limited.assertStatus(429)
    assert.include(limited.text(), 'Too many control attempts')
    assert.isNotEmpty(limited.header('retry-after'))
    assert.isNotEmpty(limited.header('x-ratelimit-limit'))
    assert.isNotEmpty(limited.header('x-ratelimit-remaining'))
    assert.isNotEmpty(limited.header('x-ratelimit-reset'))

    const canonical = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ targetId: String(target.id), reason: 'Another attempt', _masqueradeContext: token })
      .loginAs(actor)
    canonical.assertStatus(429)
    assert.isNotEmpty(canonical.header('retry-after'))
  })
})
