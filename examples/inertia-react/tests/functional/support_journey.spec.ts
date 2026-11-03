import { test } from '@japa/runner'
import { mock } from 'node:test'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import {
  setMasqueradeStoreUnavailable,
  setMasqueradeTestTime,
} from '#services/masquerade_fixture_boundary'

test.group('Inertia support journey', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(async () => {
    setMasqueradeStoreUnavailable(false)
    setMasqueradeTestTime(undefined)
    await limiter.clear(['memory'])
    await cleanUsers()
  })

  test('uses raw controls and admitted customer data, and rejects sensitive or stale intent', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const idleToken = idle.body().contextToken as string
    const workspace = await client.get('/support').loginAs(actor)
    workspace.assertStatus(200)
    assert.equal(pageData(workspace.text()).component, 'support/workspace')
    assert.equal(pageData(workspace.text()).props.actor.id, actor.id)
    assert.equal(pageData(workspace.text()).props.mode.contextToken, idleToken)
    assert.notProperty(pageData(workspace.text()).props.actor, 'securityStamp')

    const start = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .form({
        targetId: String(target.id),
        reason: 'Customer request',
        access: 'edit',
        _masqueradeContext: idleToken,
      })
      .loginAs(actor)
    start.assertStatus(302)
    const active = await client.get('/masquerade').loginAs(actor)
    const activeToken = active.body().contextToken as string
    const page = await client.get('/support/customer').loginAs(actor)
    page.assertStatus(200)
    assert.equal(pageData(page.text()).props.mode.access, 'edit')
    assert.equal(pageData(page.text()).props.customer.id, target.id)
    assert.equal(pageData(page.text()).props.actor.id, actor.id)
    assert.equal(pageData(page.text()).props.user.email, actor.email)
    assert.equal(pageData(page.text()).props.mode.contextToken, activeToken)
    assert.notProperty(pageData(page.text()).props.customer, 'password')

    const preference = await client
      .post('/support/customer/preference')
      .redirects(0)
      .withCsrfToken()
      .form({ emailUpdates: '1', _masqueradeContext: activeToken })
      .loginAs(actor)
    preference.assertStatus(302)
    const savedPreference = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(savedPreference?.email_updates, 1)

    const sensitive = await client
      .post('/support/customer/sensitive')
      .header('Accept', 'text/html')
      .redirects(0)
      .withCsrfToken()
      .form({ _masqueradeContext: activeToken })
      .loginAs(actor)
    sensitive.assertStatus(302)
    assert.equal(sensitive.header('location'), '/support/recovery')
    sensitive.assertFlashMessage('supportRecoveryTitle', 'Sensitive action is unavailable')
    const sensitiveRecovery = await client
      .get('/support/recovery')
      .withFlashMessages(sensitive.flashMessages())
      .loginAs(actor)
    assert.equal(pageData(sensitiveRecovery.text()).props.title, 'Sensitive action is unavailable')
    const afterSensitive = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(afterSensitive?.email_updates, 1)

    const stopped = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .form({ _masqueradeContext: activeToken })
      .loginAs(actor)
    stopped.assertStatus(302)
    const stale = await client
      .post('/support/customer/preference')
      .withCsrfToken()
      .form({ emailUpdates: '0', _masqueradeContext: activeToken })
      .loginAs(actor)
    stale.assertStatus(409)
    const afterStale = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(afterStale?.email_updates, 1)
  })

  test('view-only start blocks the edit and renders the host page', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const start = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .form({
        targetId: String(target.id),
        reason: 'Read-only support request',
        access: 'view',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    start.assertStatus(302)

    const customer = await client.get('/support/customer').loginAs(actor)
    customer.assertStatus(200)
    assert.equal(pageData(customer.text()).props.mode.access, 'view')
    const context = pageData(customer.text()).props.mode.contextToken as string
    const blocked = await client
      .post('/support/customer/preference')
      .header('Accept', 'text/html')
      .redirects(0)
      .withCsrfToken()
      .form({ emailUpdates: '1', _masqueradeContext: context })
      .loginAs(actor)
    blocked.assertStatus(302)
    assert.equal(blocked.header('location'), '/support/recovery')
    blocked.assertFlashMessage('supportRecoveryTitle', 'View-only support mode blocked this change')

    const recovery = await client
      .get('/support/recovery')
      .withFlashMessages(blocked.flashMessages())
      .loginAs(actor)
    assert.equal(
      pageData(recovery.text()).props.title,
      'View-only support mode blocked this change'
    )
    assert.include(
      pageData(recovery.text()).props.message,
      'This support mode can read customer information but cannot change it.'
    )
    assert.isNull(await db.from('demo_preferences').where('user_id', target.id).first())
  })

  test('rejects missing idle context and old A intent after stopping and starting B', async ({
    client,
    assert,
  }) => {
    const { actor, target: customerA } = await createUsers()
    const { target: customerB } = await createUsers()
    const noContext = await client
      .post('/support/start')
      .withCsrfToken()
      .form({ targetId: String(customerA.id), reason: 'Missing context' })
      .loginAs(actor)
    noContext.assertStatus(428)
    await limiter.clear(['memory'])
    const idle = await client.get('/masquerade').loginAs(actor)
    const startA = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .form({
        targetId: String(customerA.id),
        reason: 'First customer',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    startA.assertStatus(302)
    const activeA = await client.get('/masquerade').loginAs(actor)
    const tokenA = activeA.body().contextToken as string
    const stopA = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .form({ _masqueradeContext: tokenA })
      .loginAs(actor)
    stopA.assertStatus(302)
    const idleAgain = await client.get('/masquerade').loginAs(actor)
    const startB = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .form({
        targetId: String(customerB.id),
        reason: 'Second customer',
        _masqueradeContext: idleAgain.body().contextToken,
      })
      .loginAs(actor)
    startB.assertStatus(302)
    const page = await client.get('/support/customer').loginAs(actor)
    page.assertStatus(200)
    assert.equal(pageData(page.text()).props.customer.id, customerB.id)
    const stale = await client
      .post('/support/customer/preference')
      .withCsrfToken()
      .form({ emailUpdates: '1', _masqueradeContext: tokenA })
      .loginAs(actor)
    stale.assertStatus(409)
    assert.isNull(await db.from('demo_preferences').where('user_id', customerB.id).first())
  })

  test('rejects an intent at the exact fixed deadline', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const current = Date.now()
    mock.timers.enable({ apis: ['Date'], now: current })
    try {
      const idle = await client.get('/masquerade').loginAs(actor)
      const started = await client
        .post('/masquerade/start')
        .withCsrfToken()
        .form({
          targetId: String(target.id),
          reason: 'Deadline test',
          access: 'edit',
          _masqueradeContext: idle.body().contextToken,
        })
        .loginAs(actor)
      started.assertStatus(200)
      const deadline = Date.parse(started.body().expiresAt)
      mock.timers.setTime(deadline)
      setMasqueradeTestTime(deadline)
      const denied = await client
        .post('/support/customer/preference')
        .withCsrfToken()
        .form({ emailUpdates: '1', _masqueradeContext: started.body().contextToken })
        .loginAs(actor)
      denied.assertStatus(409)
      assert.isNull(await db.from('demo_preferences').where('user_id', target.id).first())
    } finally {
      setMasqueradeTestTime(undefined)
      mock.timers.reset()
    }
  })

  test('renders recovery when raw state is unavailable without replaying control', async ({
    client,
    assert,
  }) => {
    const { actor } = await createUsers()
    setMasqueradeStoreUnavailable(true)
    const unavailable = await client
      .get('/support')
      .header('Accept', 'text/html')
      .redirects(0)
      .loginAs(actor)
    unavailable.assertStatus(302)
    assert.equal(unavailable.header('location'), '/support/recovery')
  })

  test('recovers through raw status and stop after target admission fails', async ({
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
        reason: 'Recovery',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(200)
    target.active = false
    await target.save()
    const customer = await client.get('/support/customer').loginAs(actor)
    customer.assertStatus(409)
    const workspace = await client.get('/support').loginAs(actor)
    workspace.assertStatus(200)
    assert.equal(pageData(workspace.text()).props.targetAvailable, false)
    const fresh = pageData(workspace.text()).props.mode.contextToken
    const stop = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .form({ _masqueradeContext: fresh })
      .loginAs(actor)
    stop.assertStatus(302)
  })
})

function pageData(html: string): any {
  const encoded = html.match(/data-page="([^"]+)"/)?.[1]
  if (!encoded) throw new Error('Missing Inertia page')
  return JSON.parse(
    encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'")
  )
}
