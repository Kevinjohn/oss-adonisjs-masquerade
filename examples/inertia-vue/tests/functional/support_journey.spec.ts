import { test } from '@japa/runner'
import { mock } from 'node:test'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import { setMasqueradeStoreUnavailable } from '#services/masquerade_fixture_boundary'

test.group('Inertia Vue support journey', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(async () => {
    setMasqueradeStoreUnavailable(false)
    await cleanUsers()
  })

  test('keeps the raw actor, admits customer work, and rejects sensitive and stale intent', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const idleToken = idle.body().contextToken as string
    const workspace = await client.get('/support').loginAs(actor)
    workspace.assertStatus(200)
    const workspacePage = pageData(workspace.text())
    assert.equal(workspacePage.component, 'support/workspace')
    assert.equal(workspacePage.props.actor.id, actor.id)
    assert.equal(workspacePage.props.mode.contextToken, idleToken)
    assert.notProperty(workspacePage.props.actor, 'securityStamp')

    const start = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .form({
        targetId: String(target.id),
        reason: 'Customer asked for help',
        access: 'edit',
        _masqueradeContext: idleToken,
      })
      .loginAs(actor)
    start.assertStatus(302)

    const active = await client.get('/masquerade').loginAs(actor)
    const activeToken = active.body().contextToken as string
    const customerPage = await client.get('/support/customer').loginAs(actor)
    customerPage.assertStatus(200)
    const props = pageData(customerPage.text()).props
    assert.equal(props.customer.id, target.id)
    assert.equal(props.actor.id, actor.id)
    assert.equal(props.user.email, actor.email)
    assert.equal(props.mode.contextToken, activeToken)
    assert.equal(props.mode.access, 'edit')
    assert.notProperty(props.customer, 'password')
    assert.notProperty(props.mode, 'reason')

    const changed = await client
      .post('/support/customer/preference')
      .redirects(0)
      .withCsrfToken()
      .form({
        emailUpdates: '1',
        _masqueradeContext: activeToken,
      })
      .loginAs(actor)
    changed.assertStatus(302)
    const preference = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(preference?.email_updates, 1)

    const denied = await client
      .post('/support/customer/sensitive')
      .withCsrfToken()
      .form({ _masqueradeContext: activeToken })
      .loginAs(actor)
    denied.assertStatus(403)
    const preferenceAfterDenied = await db
      .from('demo_preferences')
      .where('user_id', target.id)
      .first()
    assert.equal(preferenceAfterDenied?.email_updates, 1)

    const stop = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .form({ _masqueradeContext: activeToken })
      .loginAs(actor)
    stop.assertStatus(302)
    const stale = await client
      .post('/support/customer/preference')
      .withCsrfToken()
      .form({ emailUpdates: '0', _masqueradeContext: activeToken })
      .loginAs(actor)
    stale.assertStatus(409)
    const preferenceAfterStaleIntent = await db
      .from('demo_preferences')
      .where('user_id', target.id)
      .first()
    assert.equal(preferenceAfterStaleIntent?.email_updates, 1)
  })

  test('requires context while idle and never rebinds a retained action across customer A to B', async ({
    client,
    assert,
  }) => {
    const { actor, target: customerA } = await createUsers()
    const { target: customerB } = await createUsers()
    const missing = await client
      .post('/support/start')
      .withCsrfToken()
      .form({ targetId: String(customerA.id), reason: 'No token' })
      .loginAs(actor)
    missing.assertStatus(428)

    const idle = await client.get('/support').loginAs(actor)
    const idleToken = pageData(idle.text()).props.mode.contextToken as string
    const startA = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .form({
        targetId: String(customerA.id),
        reason: 'First customer',
        access: 'edit',
        _masqueradeContext: idleToken,
      })
      .loginAs(actor)
    startA.assertStatus(302)
    const activeAfterA = await client.get('/masquerade').loginAs(actor)
    const tokenA = activeAfterA.body().contextToken as string
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
        access: 'edit',
        _masqueradeContext: idleAgain.body().contextToken,
      })
      .loginAs(actor)
    startB.assertStatus(302)
    const current = await client.get('/support/customer').loginAs(actor)
    assert.equal(pageData(current.text()).props.customer.id, customerB.id)
    const oldIntent = await client
      .post('/support/customer/preference')
      .withCsrfToken()
      .form({
        emailUpdates: '1',
        _masqueradeContext: tokenA,
      })
      .loginAs(actor)
    oldIntent.assertStatus(409)
    const preferenceForCustomerB = await db
      .from('demo_preferences')
      .where('user_id', customerB.id)
      .first()
    assert.isNull(preferenceForCustomerB)
  })

  test('view-only start blocks the edit and renders the host page', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/support').loginAs(actor)
    const started = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .form({
        targetId: String(target.id),
        reason: 'Read customer details',
        _masqueradeContext: pageData(idle.text()).props.mode.contextToken,
      })
      .loginAs(actor)
    started.assertStatus(302)

    const active = await client.get('/masquerade').loginAs(actor)
    const token = active.body().contextToken as string
    const blocked = await client
      .post('/support/customer/preference')
      .redirects(0)
      .header('Accept', 'text/html')
      .withCsrfToken()
      .form({ emailUpdates: '1', _masqueradeContext: token })
      .loginAs(actor)
    blocked.assertStatus(302)
    assert.equal(blocked.header('location'), '/support/recovery')
    blocked.assertFlashMessage('supportRecoveryTitle', 'Edit blocked in view-only mode')
    blocked.assertFlashMessage(
      'supportRecovery',
      'This support session is view only. Start a new session and choose Can edit to make changes.'
    )

    const recovery = await client
      .get('/support/recovery')
      .withFlashMessages(blocked.flashMessages())
      .loginAs(actor)
    const props = pageData(recovery.text()).props
    assert.equal(props.title, 'Edit blocked in view-only mode')
    assert.include(props.message, 'This support session is view only')
    const preference = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.isNull(preference)
  })

  test('rejects covered work at the fixed expiry instant', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    try {
      const idle = await client.get('/masquerade').loginAs(actor)
      const started = await client
        .post('/masquerade/start')
        .redirects(0)
        .withCsrfToken()
        .form({
          targetId: String(target.id),
          reason: 'Fixed deadline',
          access: 'edit',
          _masqueradeContext: idle.body().contextToken,
        })
        .loginAs(actor)
      started.assertStatus(200)
      assert.isTrue(started.body().isMasquerading)
      const active = await client.get('/masquerade').loginAs(actor)
      const deadline = Date.parse(active.body().expiresAt)
      const token = active.body().contextToken
      mock.timers.enable({ apis: ['Date'], now: deadline })
      const denied = await client
        .post('/support/customer/preference')
        .redirects(0)
        .withCsrfToken()
        .form({ emailUpdates: '1', _masqueradeContext: token })
        .loginAs(actor)
      denied.assertStatus(409)
      const preferenceAtExpiry = await db
        .from('demo_preferences')
        .where('user_id', target.id)
        .first()
      assert.isNull(preferenceAtExpiry)
    } finally {
      mock.timers.reset()
    }
  })

  test('provides raw recovery when storage is unavailable or customer admission is revoked', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    setMasqueradeStoreUnavailable(true)
    const unavailable = await client
      .get('/support')
      .header('Accept', 'text/html')
      .redirects(0)
      .loginAs(actor)
    unavailable.assertStatus(302)
    assert.equal(unavailable.header('location'), '/support/recovery')

    setMasqueradeStoreUnavailable(false)
    const idle = await client.get('/masquerade').loginAs(actor)
    const started = await client
      .post('/support/start')
      .redirects(0)
      .withCsrfToken()
      .form({
        targetId: String(target.id),
        reason: 'Recovery path',
        _masqueradeContext: idle.body().contextToken,
      })
      .loginAs(actor)
    started.assertStatus(302)
    target.active = false
    await target.save()
    const blocked = await client.get('/support/customer').loginAs(actor)
    blocked.assertStatus(409)
    const workspace = await client.get('/support').loginAs(actor)
    const props = pageData(workspace.text()).props
    assert.equal(props.targetAvailable, false)
    const stop = await client
      .post('/support/stop')
      .redirects(0)
      .withCsrfToken()
      .form({ _masqueradeContext: props.mode.contextToken })
      .loginAs(actor)
    stop.assertStatus(302)
  })
})

function pageData(html: string): any {
  const encoded = html.match(
    /<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/
  )?.[1]
  if (!encoded) throw new Error('Missing Inertia page data')
  return JSON.parse(encoded)
}
