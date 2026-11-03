import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import { AccountKitHttp } from '#tests/helpers/account_kit_http'
import { cleanUsers, createUsers } from '#tests/helpers/users'

test.group('Account Kit demo admission', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanUsers())

  test('revoked operator cannot reach any guarded route or query mode state', async ({
    assert,
  }) => {
    const { actor, target } = await createUsers()
    actor.emailVerifiedAt = DateTime.utc()
    target.emailVerifiedAt = DateTime.utc()
    await actor.save()
    await target.save()
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.approve({ email: actor.email })
    await admission.operator.approve({ email: target.email })
    const http = new AccountKitHttp()
    const { csrf } = await http.login(actor.email, 'secret', 'session')
    const idle = await http.request('/masquerade', { headers: { accept: 'application/json' } })
    const context = ((await idle.json()) as { contextToken: string }).contextToken
    const userBefore = await db.from('users').where('id', actor.id).first()
    const targetBefore = await db.from('users').where('id', target.id).first()
    const modesBefore = await db.from('masquerade_modes').where('actor_id', String(actor.id))
    const eventsBefore = await db.from('masquerade_events').where('actor_id', String(actor.id))
    await admission.operator.revoke({ email: actor.email })
    const queries: string[] = []
    const client = db.connection().getWriteClient()
    const listener = (query: { sql: string }) => {
      if (/masquerade_(modes|events)/i.test(query.sql)) queries.push(query.sql)
    }
    client.on('query', listener)
    try {
      const requests: { path: string; method: 'GET' | 'POST'; body?: Record<string, string> }[] = [
        { path: '/support', method: 'GET' },
        { path: '/support/customer', method: 'GET' },
        { path: '/support/customer/preference', method: 'POST', body: { emailUpdates: '1' } },
        { path: '/support/account', method: 'GET' },
        { path: '/dashboard', method: 'GET' },
        {
          path: '/support/start',
          method: 'POST',
          body: { targetId: String(target.id), reason: 'Review', access: 'edit' },
        },
        { path: '/support/stop', method: 'POST', body: {} },
      ]
      for (const item of requests) {
        const headers = {
          'accept': 'application/json',
          'x-csrf-token': csrf,
          'X-Masquerade-Context': context,
        }
        const result =
          item.method === 'GET'
            ? await http.request(item.path, { headers })
            : await http.json(item.path, 'POST', item.body ?? {}, headers)
        assert.equal(result.status, 403, item.path)
        const errorBody = (await result.json()) as { code: string }
        assert.equal(errorBody.code, 'E_ACCOUNT_KIT_ADMISSION_REQUIRED', item.path)
      }
      assert.deepEqual(queries, [])
      assert.deepEqual(await db.from('users').where('id', actor.id).first(), userBefore)
      assert.deepEqual(await db.from('users').where('id', target.id).first(), targetBefore)
      assert.deepEqual(
        await db.from('masquerade_modes').where('actor_id', String(actor.id)),
        modesBefore
      )
      assert.deepEqual(
        await db.from('masquerade_events').where('actor_id', String(actor.id)),
        eventsBefore
      )
    } finally {
      client.off('query', listener)
    }
    await admission.operator.approve({ email: actor.email })
    const restored = await http.request('/support', { headers: { accept: 'text/html' } })
    assert.equal(restored.status, 200)
  })
})
