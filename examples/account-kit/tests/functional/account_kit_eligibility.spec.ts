import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import User from '#models/user'
import { AccountKitHttp } from '#tests/helpers/account_kit_http'
import {
  accountKitPassword,
  cleanAccountKitUsers,
  createAccountKitUsers,
} from '#tests/helpers/account_kit_credentials'
import { approveUsers } from '#tests/helpers/account_kit_admission'

const strategy =
  process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens' ? 'access_tokens' : 'session'
const control = strategy === 'session' ? '/masquerade' : '/api/masquerade'
const business = strategy === 'session' ? '/business' : '/api/business'

async function json(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>
}

async function createEligiblePair() {
  const { actor, target } = await createAccountKitUsers()
  await db
    .from('users')
    .whereIn('id', [actor.id, target.id])
    .update({ email_verified_at: DateTime.now().toISO() })
  await approveUsers(actor, target)
  return { actor, target }
}

async function actorSession(actor: User) {
  const http = new AccountKitHttp()
  const login = await http.login(actor.email, accountKitPassword, strategy)
  return {
    http,
    csrf: login.csrf ?? '',
    authorization: login.token ? `Bearer ${login.token}` : '',
  }
}

function headers(
  session: Awaited<ReturnType<typeof actorSession>>,
  extra: Record<string, string> = {}
) {
  return {
    accept: 'application/json',
    ...(session.authorization ? { authorization: session.authorization } : {}),
    ...(session.csrf ? { 'x-csrf-token': session.csrf } : {}),
    ...extra,
  }
}

async function idleContext(session: Awaited<ReturnType<typeof actorSession>>) {
  const response = await session.http.request(control, { headers: headers(session) })
  if (response.status !== 200) throw new Error(`Masquerade status returned ${response.status}`)
  return (await json(response)).contextToken as string
}

async function startMode(session: Awaited<ReturnType<typeof actorSession>>, targetId: number) {
  const response = await session.http.json(
    `${control}/start`,
    'POST',
    { targetId, reason: 'Account Kit eligibility acceptance', access: 'edit' },
    headers(session, { 'X-Masquerade-Context': await idleContext(session) })
  )
  return response
}

async function startActiveMode(
  session: Awaited<ReturnType<typeof actorSession>>,
  targetId: number
) {
  const response = await startMode(session, targetId)
  if (response.status !== 200)
    throw new Error(`Masquerade start returned ${response.status}: ${await response.text()}`)
  return json(response)
}

async function modeRow(actorId: number) {
  return db.from('masquerade_modes').where('actor_id', String(actorId)).first()
}

async function actorEvents(actorId: number) {
  return db.from('masquerade_events').where('actor_id', String(actorId)).orderBy('revision', 'asc')
}

async function changeAccountRestriction(user: User, active: boolean) {
  const kit = await app.container.make(AccountKit)
  await kit.authentication.changeRestriction({
    userId: user.id,
    change: async (_account, trx) => {
      await trx.from('users').where('id', user.id).update({ active })
    },
  })
}

async function captureModeQueries<T>(run: () => Promise<T>) {
  const client = db.connection().getWriteClient()
  const queries: string[] = []
  const listener = (query: { sql: string }) => {
    if (/masquerade_(?:modes|events)/i.test(query.sql)) queries.push(query.sql)
  }
  client.on('query', listener)
  try {
    return { result: await run(), queries }
  } finally {
    client.removeListener('query', listener)
  }
}

test.group('packed Account Kit eligibility inspection', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanAccountKitUsers())

  test('missing, restricted, and unconfirmed targets receive the same start denial without a mode', async ({
    assert,
  }) => {
    const denied: Array<Record<string, any>> = []

    for (const kind of ['missing', 'restricted', 'unconfirmed'] as const) {
      const { actor, target } = await createEligiblePair()
      if (kind === 'restricted') {
        await changeAccountRestriction(target, false)
      }
      if (kind === 'unconfirmed') {
        await db.from('users').where('id', target.id).update({
          unverified_email: target.email,
          email_verified_at: null,
        })
      }
      const session = await actorSession(actor)
      const response = await startMode(
        session,
        kind === 'missing' ? target.id + 1000000 : target.id
      )
      assert.equal(response.status, 403, `${kind} target`)
      const body = await json(response)
      assert.equal(body.errors?.[0]?.code, 'E_MASQUERADE_NOT_ALLOWED')
      denied.push(body)
      assert.equal(
        (
          await db.from('masquerade_modes').where('actor_id', String(actor.id)).count('* as total')
        )[0].total,
        0
      )
      const events = await actorEvents(actor.id)
      assert.lengthOf(events, 1)
      assert.equal(events[0].kind, 'start_denied')
      assert.equal(events[0].outcome_code, 'E_MASQUERADE_NOT_ALLOWED')
      assert.isNull(events[0].target_id)
    }

    assert.deepEqual(denied[1], denied[0])
    assert.deepEqual(denied[2], denied[0])
  })

  test('missing, restricted, and unconfirmed targets invalidate active modes as target_ineligible', async ({
    assert,
  }) => {
    for (const kind of ['missing', 'restricted', 'unconfirmed'] as const) {
      const { actor, target } = await createEligiblePair()
      const session = await actorSession(actor)
      const active = await startActiveMode(session, target.id)
      const modeBefore = await modeRow(actor.id)
      const eventsBefore = await actorEvents(actor.id)
      assert.equal(modeBefore?.state, 'active')
      assert.lengthOf(eventsBefore, 1)
      assert.equal(eventsBefore[0].kind, 'started')

      if (kind === 'missing') await User.query().where('id', target.id).delete()
      if (kind === 'restricted') await changeAccountRestriction(target, false)
      if (kind === 'unconfirmed')
        await db.from('users').where('id', target.id).update({
          unverified_email: target.email,
          email_verified_at: null,
        })

      const rejected = await session.http.request(business, {
        headers: headers(session, { 'X-Masquerade-Context': active.contextToken }),
      })
      assert.equal(rejected.status, 409, `${kind} target`)
      const response = await json(rejected)
      assert.equal(response.errors?.[0]?.code, 'E_MASQUERADE_CONTEXT_CHANGED')
      const after = await modeRow(actor.id)
      assert.equal(after?.state, 'idle')
      assert.isNull(after?.target_id)
      const eventsAfter = await actorEvents(actor.id)
      assert.lengthOf(eventsAfter, eventsBefore.length + 1)
      assert.deepEqual(eventsAfter.slice(0, eventsBefore.length), eventsBefore)
      assert.equal(eventsAfter.at(-1)?.kind, 'invalidated')
      assert.equal(eventsAfter.at(-1)?.outcome_code, 'target_ineligible')
    }
  })

  test('a Kit-restricted actor is rejected before the active mode is read or changed', async ({
    assert,
  }) => {
    const { actor, target } = await createEligiblePair()
    const session = await actorSession(actor)
    const active = await startActiveMode(session, target.id)
    const modeBefore = await modeRow(actor.id)
    const eventsBefore = await actorEvents(actor.id)
    assert.equal(modeBefore?.state, 'active')

    await changeAccountRestriction(actor, false)
    const { result, queries } = await captureModeQueries(() =>
      session.http.request(business, {
        headers: headers(session, { 'X-Masquerade-Context': active.contextToken }),
      })
    )
    assert.equal(result.status, 401)
    assert.deepEqual(queries, [])
    assert.deepEqual(await modeRow(actor.id), modeBefore)
    assert.deepEqual(await actorEvents(actor.id), eventsBefore)
  })

  test('an unreadable persisted SQLite target revision returns 503 and preserves active state', async ({
    assert,
  }) => {
    const { actor, target } = await createEligiblePair()
    const session = await actorSession(actor)
    const active = await startActiveMode(session, target.id)
    const modeBefore = await modeRow(actor.id)
    const eventsBefore = await actorEvents(actor.id)
    const original = await db
      .from('users')
      .select('credentials_changed_at')
      .where('id', target.id)
      .first()
    try {
      await db
        .from('users')
        .where('id', target.id)
        .update({ credentials_changed_at: 'unreadable revision' })

      const failed = await session.http.request(business, {
        headers: headers(session, { 'X-Masquerade-Context': active.contextToken }),
      })
      assert.equal(failed.status, 503)
      assert.equal((await json(failed)).errors?.[0]?.code, 'E_MASQUERADE_UNAVAILABLE')
      assert.deepEqual(await modeRow(actor.id), modeBefore)
      assert.deepEqual(await actorEvents(actor.id), eventsBefore)
    } finally {
      await db
        .from('users')
        .where('id', target.id)
        .update({ credentials_changed_at: original?.credentials_changed_at ?? null })
    }
    assert.deepEqual(await modeRow(actor.id), modeBefore)
  }).skip(process.env.DB_CLIENT === 'pg', 'SQLite accepts malformed timestamp text for this case')

  test('an unresolvable PostgreSQL target identifier returns 503 and preserves active state', async ({
    assert,
  }) => {
    const { actor, target } = await createEligiblePair()
    const session = await actorSession(actor)
    const active = await startActiveMode(session, target.id)
    const originalMode = await modeRow(actor.id)
    const eventsBefore = await actorEvents(actor.id)
    assert.equal(originalMode?.target_id, String(target.id))
    let injectedMode: Awaited<ReturnType<typeof modeRow>> | undefined
    try {
      await db
        .from('masquerade_modes')
        .where('actor_id', String(actor.id))
        .update({ target_id: 'not-a-postgresql-integer' })
      injectedMode = await modeRow(actor.id)
      const failed = await session.http.request(business, {
        headers: headers(session, { 'X-Masquerade-Context': active.contextToken }),
      })
      assert.equal(failed.status, 503)
      assert.equal((await json(failed)).errors?.[0]?.code, 'E_MASQUERADE_UNAVAILABLE')
      assert.deepEqual(await modeRow(actor.id), injectedMode)
      assert.deepEqual(await actorEvents(actor.id), eventsBefore)
    } finally {
      await db
        .from('masquerade_modes')
        .where('actor_id', String(actor.id))
        .update({ target_id: originalMode!.target_id })
    }
    assert.deepEqual(await modeRow(actor.id), originalMode)
  }).skip(process.env.DB_CLIENT !== 'pg', 'requires PostgreSQL integer identifier behavior')
})
