import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import { approveUsers } from '#tests/helpers/account_kit_admission'
import { AccountKitHttp } from '#tests/helpers/account_kit_http'

const strategy =
  process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens' ? 'access_tokens' : 'session'
const control = strategy === 'session' ? '/masquerade' : '/api/masquerade'
const business = strategy === 'session' ? '/business' : '/api/business'
const password = 'AccountKitPass123!'

async function accountPair() {
  const { actor, target } = await createUsers()
  actor.password = password
  actor.emailVerifiedAt = DateTime.now()
  target.emailVerifiedAt = DateTime.now()
  await actor.save()
  await target.save()
  await approveUsers(actor, target)
  return { actor, target }
}

test.group('packed Account Kit admission', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanUsers())

  test('revoked actor admission denies the active business route before mode read; approval resumes it', async ({
    assert,
  }) => {
    const { actor, target } = await accountPair()
    const http = new AccountKitHttp()
    const credential = await http.login(actor.email, password, strategy)
    const authorization = credential.token ? { authorization: `Bearer ${credential.token}` } : {}
    const status = await http.request(control, {
      headers: { accept: 'application/json', ...authorization },
    })
    assert.equal(status.status, 200)
    const idle = (await status.json()) as { contextToken: string }
    const started = await http.json(
      `${control}/start`,
      'POST',
      {
        targetId: target.id,
        reason: 'admission regression',
        access: 'edit',
      },
      {
        ...authorization,
        'X-Masquerade-Context': idle.contextToken,
        ...(credential.csrf ? { 'x-csrf-token': credential.csrf } : {}),
      }
    )
    assert.equal(started.status, 200)
    const active = (await started.json()) as { contextToken: string }
    const before = await db.from('masquerade_modes').where('actor_id', String(actor.id)).first()
    const eventsBefore = await db.from('masquerade_events').where('actor_id', String(actor.id))
    assert.isNotNull(before)

    const admission = await app.container.make(AccountAdmission)
    await admission.operator.revoke({ email: actor.email })
    const client = db.connection().getWriteClient()
    const modeQueries: string[] = []
    const listener = (query: { sql: string }) => {
      if (/masquerade_(?:modes|events)/i.test(query.sql)) modeQueries.push(query.sql)
    }
    client.on('query', listener)
    let denied: Response
    try {
      denied = await http.request(business, {
        headers: {
          'accept': 'application/json',
          ...authorization,
          'X-Masquerade-Context': active.contextToken,
        },
      })
    } finally {
      client.removeListener('query', listener)
    }
    assert.equal(denied.status, 403)
    assert.isEmpty(modeQueries)
    const after = await db.from('masquerade_modes').where('actor_id', String(actor.id)).first()
    assert.deepEqual(after, before)
    assert.deepEqual(
      await db.from('masquerade_events').where('actor_id', String(actor.id)),
      eventsBefore
    )

    await admission.operator.approve({ email: actor.email })
    const resumed = await http.request(business, {
      headers: {
        'accept': 'application/json',
        ...authorization,
        'X-Masquerade-Context': active.contextToken,
      },
    })
    assert.equal(resumed.status, 200)
    const result = (await resumed.json()) as { actorId: number; effectiveId: number }
    assert.equal(result.actorId, actor.id)
    assert.equal(result.effectiveId, target.id)
    assert.deepEqual(
      await db.from('masquerade_modes').where('actor_id', String(actor.id)).first(),
      before
    )
  })

  test('revoked target admission denies start without creating a mode', async ({ assert }) => {
    const { actor, target } = await accountPair()
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.revoke({ email: target.email })
    const http = new AccountKitHttp()
    const credential = await http.login(actor.email, password, strategy)
    const authorization = credential.token ? { authorization: `Bearer ${credential.token}` } : {}
    const status = await http.request(control, {
      headers: { accept: 'application/json', ...authorization },
    })
    assert.equal(status.status, 200)
    const idle = (await status.json()) as { contextToken: string }
    const denied = await http.json(
      `${control}/start`,
      'POST',
      {
        targetId: target.id,
        reason: 'target admission regression',
        access: 'edit',
      },
      {
        ...authorization,
        'X-Masquerade-Context': idle.contextToken,
        ...(credential.csrf ? { 'x-csrf-token': credential.csrf } : {}),
      }
    )
    assert.equal(denied.status, 403)
    assert.equal(
      (await db.from('masquerade_modes').where('actor_id', String(actor.id)).count('* as total'))[0]
        .total,
      0
    )
  })

  test('revoked target admission invalidates an active mode with policy_denied', async ({
    assert,
  }) => {
    const { actor, target } = await accountPair()
    const http = new AccountKitHttp()
    const credential = await http.login(actor.email, password, strategy)
    const authorization = credential.token ? { authorization: `Bearer ${credential.token}` } : {}
    const status = await http.request(control, {
      headers: { accept: 'application/json', ...authorization },
    })
    assert.equal(status.status, 200)
    const idle = (await status.json()) as { contextToken: string }
    const started = await http.json(
      `${control}/start`,
      'POST',
      {
        targetId: target.id,
        reason: 'active target admission regression',
        access: 'edit',
      },
      {
        ...authorization,
        'X-Masquerade-Context': idle.contextToken,
        ...(credential.csrf ? { 'x-csrf-token': credential.csrf } : {}),
      }
    )
    assert.equal(started.status, 200)
    const active = (await started.json()) as { contextToken: string }
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.revoke({ email: target.email })
    const denied = await http.request(business, {
      headers: {
        'accept': 'application/json',
        ...authorization,
        'X-Masquerade-Context': active.contextToken,
      },
    })
    assert.equal(denied.status, 409)
    const rows = await db.from('masquerade_modes').where('actor_id', String(actor.id))
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].state, 'idle')
    const events = await db
      .from('masquerade_events')
      .where('actor_id', String(actor.id))
      .orderBy('revision', 'desc')
    assert.equal(events[0].outcome_code, 'policy_denied')
  })
})
