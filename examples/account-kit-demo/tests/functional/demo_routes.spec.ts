import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import { AccountKitHttp } from '#tests/helpers/account_kit_http'
import { cleanUsers, createUsers } from '#tests/helpers/users'

test.group('Account Kit demo pages', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanUsers())

  test('renders public and signed-in pages and redirects anonymous support', async ({ assert }) => {
    const anonymous = new AccountKitHttp()
    const home = await anonymous.request('/', { headers: { accept: 'text/html' } })
    assert.equal(home.status, 200, '/')
    assert.include(await home.text(), 'Welcome to the power of a Hypermedia app.')
    const login = await anonymous.request('/login', { headers: { accept: 'text/html' } })
    assert.equal(login.status, 200, '/login')
    const loginHtml = await login.text()
    assert.include(loginHtml, 'data-demo="account-kit"')
    assert.include(loginHtml, 'Sign in to support')
    const unknown = await anonymous.request('/unknown-account-kit-demo-path', {
      headers: { accept: 'text/html' },
    })
    assert.equal(unknown.status, 404, '/unknown-account-kit-demo-path')
    const denied = await anonymous.request('/support', { headers: { accept: 'text/html' } })
    assert.equal(denied.status, 302)
    assert.include(denied.headers.get('location') ?? '', '/login')
    const { actor } = await createUsers()
    actor.emailVerifiedAt = DateTime.utc()
    await actor.save()
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.approve({ email: actor.email })
    const http = new AccountKitHttp()
    await http.login(actor.email, 'secret', 'session')
    for (const path of ['/dashboard', '/support', '/support/account']) {
      const result = await http.request(path, { headers: { accept: 'text/html' } })
      assert.equal(result.status, 200, path)
    }
    const account = await http.request('/support/account', { headers: { accept: 'text/html' } })
    assert.include(await account.text(), actor.fullName ?? actor.email)
  })

  test('wrong login fails, right login creates a session, logout removes it', async ({
    assert,
  }) => {
    const { actor } = await createUsers()
    actor.emailVerifiedAt = DateTime.utc()
    await actor.save()
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.approve({ email: actor.email })
    const http = new AccountKitHttp()
    const csrf = await http.csrf()
    const wrong = await http.json(
      '/kit/auth/login',
      'POST',
      { email: actor.email, password: 'bad' },
      { 'x-csrf-token': csrf }
    )
    assert.equal(wrong.status, 401)
    const wrongBody = (await wrong.json()) as { errors?: Array<{ code?: unknown }> }
    assert.equal(wrongBody.errors?.[0]?.code, 'E_INVALID_CREDENTIALS')
    assert.isNull(await db.from('account_sessions').where('user_id', actor.id).first())
    await http.login(actor.email, 'secret', 'session')
    assert.isNotNull(await db.from('account_sessions').where('user_id', actor.id).first())
    const logout = await http.json(
      '/kit/account/logout',
      'POST',
      {},
      { 'x-csrf-token': await http.csrf() }
    )
    assert.equal(logout.status, 204)
    assert.isNull(await db.from('account_sessions').where('user_id', actor.id).first())
    const support = await http.request('/support', { headers: { accept: 'text/html' } })
    assert.equal(support.status, 302)
  })
})
