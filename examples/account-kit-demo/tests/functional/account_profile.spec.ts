import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import { AccountKitHttp } from '#tests/helpers/account_kit_http'
import { cleanUsers, createUsers } from '#tests/helpers/users'

test.group('Account Kit demo profile', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(async () => {
    await limiter.clear(['memory'])
    await cleanUsers()
  })

  test('rejects every unowned field and bad name without changing either user', async ({
    assert,
  }) => {
    const { actor, target } = await createUsers()
    actor.emailVerifiedAt = DateTime.utc()
    await actor.save()
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.approve({ email: actor.email })
    const http = new AccountKitHttp()
    const { csrf } = await http.login(actor.email, 'secret', 'session')
    const before = await db.from('users').where('id', actor.id).first()
    const customerBefore = await db.from('users').where('id', target.id).first()
    const normal = { currentPassword: 'secret', registrationData: { fullName: 'New Name' } }
    const invalid = [
      ...['masqueradeOperator', 'canMutate', 'active', 'securityStamp', 'email'].map((key) => ({
        ...normal,
        registrationData: { ...normal.registrationData, [key]: true },
      })),
      ...['email', 'role', 'newPassword', 'recentProof'].map((key) => ({ ...normal, [key]: 'x' })),
      ...['', '   ', 'a'.repeat(81)].map((fullName) => ({
        ...normal,
        registrationData: { fullName },
      })),
      { ...normal, currentPassword: '' },
      { ...normal, currentPassword: 42 },
    ]
    for (const body of invalid) {
      const result = await http.json('/kit/account/profile', 'PATCH', body, {
        'x-csrf-token': csrf,
      })
      assert.equal(result.status, 422, JSON.stringify(body))
      assert.deepEqual(await db.from('users').where('id', actor.id).first(), before)
      assert.deepEqual(await db.from('users').where('id', target.id).first(), customerBefore)
    }
    for (const body of [
      { registrationData: { fullName: 'New Name' } },
      { ...normal, currentPassword: 'incorrect' },
    ]) {
      const result = await http.json('/kit/account/profile', 'PATCH', body, {
        'x-csrf-token': csrf,
      })
      assert.equal(result.status, 403)
      const errorBody = (await result.json()) as { errors: { code: string }[] }
      assert.equal(errorBody.errors[0]?.code, 'E_ACCOUNT_KIT_IDENTITY_NOT_CONFIRMED')
      assert.deepEqual(await db.from('users').where('id', actor.id).first(), before)
      assert.deepEqual(await db.from('users').where('id', target.id).first(), customerBefore)
    }
  })

  test('profile changes only operator name while idle, blocks during support mode, then succeeds after stop', async ({
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
    const beforeCustomer = await db.from('users').where('id', target.id).first()
    const original = await db.from('users').where('id', actor.id).first()
    const update = async (fullName: string) =>
      http.json(
        '/kit/account/profile',
        'PATCH',
        {
          currentPassword: 'secret',
          registrationData: { fullName },
        },
        { 'x-csrf-token': csrf }
      )
    const firstUpdate = await update(' First update ')
    assert.equal(firstUpdate.status, 200)
    const first = await db.from('users').where('id', actor.id).first()
    assert.equal(first.full_name, 'First update')
    for (const column of Object.keys(original).filter(
      (name) => name !== 'full_name' && name !== 'updated_at'
    )) {
      assert.deepEqual(first[column], original[column], column)
    }
    assert.deepEqual(await db.from('users').where('id', target.id).first(), beforeCustomer)
    const idle = await http.request('/masquerade', { headers: { accept: 'application/json' } })
    const idleToken = ((await idle.json()) as { contextToken: string }).contextToken
    const started = await http.json(
      '/masquerade/start',
      'POST',
      {
        targetId: target.id,
        reason: 'Customer support',
        access: 'edit',
      },
      { 'x-csrf-token': csrf, 'X-Masquerade-Context': idleToken }
    )
    assert.equal(started.status, 200)
    const activeRow = await db.from('users').where('id', actor.id).first()
    const blocked = await update('Blocked update')
    assert.equal(blocked.status, 403)
    const blockedBody = (await blocked.json()) as { errors: { code: string }[] }
    assert.equal(blockedBody.errors[0]?.code, 'E_MASQUERADE_ACTION_BLOCKED')
    assert.deepEqual(await db.from('users').where('id', actor.id).first(), activeRow)
    assert.deepEqual(await db.from('users').where('id', target.id).first(), beforeCustomer)
    const active = await http.request('/masquerade', { headers: { accept: 'application/json' } })
    const activeToken = ((await active.json()) as { contextToken: string }).contextToken
    const stopped = await http.json(
      '/masquerade/stop',
      'POST',
      {},
      {
        'x-csrf-token': csrf,
        'X-Masquerade-Context': activeToken,
      }
    )
    assert.equal(stopped.status, 200)
    const finalUpdate = await update('Final update')
    assert.equal(finalUpdate.status, 200)
    const final = await db.from('users').where('id', actor.id).first()
    assert.equal(final.full_name, 'Final update')
    for (const column of Object.keys(original).filter(
      (name) => name !== 'full_name' && name !== 'updated_at'
    )) {
      assert.deepEqual(final[column], original[column], column)
    }
    assert.deepEqual(await db.from('users').where('id', target.id).first(), beforeCustomer)
    const page = await http.request('/support/account', { headers: { accept: 'text/html' } })
    assert.include(await page.text(), 'Final update')
  })
})
