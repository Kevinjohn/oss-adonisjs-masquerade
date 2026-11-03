import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { approveUsers } from '#tests/helpers/account_kit_admission'
import type { AccountKitHttp } from '#tests/helpers/account_kit_http'
import {
  accountKitJson,
  accountKitDelete,
  accountKitRequest,
  accountKitNextPassword,
  accountKitPassword,
  cleanAccountKitUsers,
  createAccountKitUsers,
  loginAccountKitUser,
  masqueradePaths,
} from '#tests/helpers/account_kit_credentials'

const { control, business } = masqueradePaths()
const sessionManagementEnabled = process.env.ACCOUNT_KIT_SESSION_MANAGEMENT === 'true'

test.group('packed Account Kit credential stamps', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanAccountKitUsers())

  test('a target credential revision invalidates mode without issuing target credentials', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)

    const targetBefore = await credentialFootprint(target.id)
    const actorLogin = await loginAccountKitUser(actor.email)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)
    const active = await accountKitRequest(actorLogin.client, business, actorLogin.credential)
    assert.equal(active.status, 200)

    // Inspection and effective-user resolution must not create or extend any target credential.
    assert.deepEqual(await credentialFootprint(target.id), targetBefore)

    const kit = await app.container.make(AccountKit)
    await kit.emailPasswordManagement.changePassword({
      actorId: target.id,
      currentPassword: accountKitPassword,
      newPassword: accountKitNextPassword,
    })

    const rejected = await accountKitRequest(actorLogin.client, business, actorLogin.credential)
    assert.equal(rejected.status, 409)
    assert.equal(await errorCode(rejected), 'E_MASQUERADE_CONTEXT_CHANGED')
    const row = await modeRow(actor.id)
    assert.equal(row?.state, 'idle')
    assert.isNull(row?.target_id)
    assert.equal(await latestOutcome(actor.id), 'target_stamp')
    const targetAfterChange = await credentialFootprint(target.id)
    assert.notDeepEqual(targetAfterChange.credentialsChangedAt, targetBefore.credentialsChangedAt)
    assert.deepEqual(targetAfterChange.sessions, targetBefore.sessions)
    assert.deepEqual(targetAfterChange.tokens, targetBefore.tokens)
  })

  test('a kept actor credential reaches admission and invalidates mode by actor stamp', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const actorLogin = await loginAccountKitUser(actor.email)
    const actorCredentialsBefore = await credentialFootprint(actor.id)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)

    const changed = await accountKitJson(
      actorLogin.client,
      '/account/password',
      actorLogin.credential,
      actorLogin.csrf,
      { currentPassword: accountKitPassword, newPassword: accountKitNextPassword }
    )
    assert.equal(changed.status, 200)
    const actorCredentialsAfter = await credentialFootprint(actor.id)
    if (actorLogin.credential.startsWith('Bearer ')) {
      assert.deepEqual(tokenIds(actorCredentialsAfter), tokenIds(actorCredentialsBefore))
    } else if (process.env.ACCOUNT_KIT_SESSION_MANAGEMENT === 'true') {
      assert.lengthOf(actorCredentialsBefore.sessions, 1)
      assert.deepEqual(sessionIds(actorCredentialsAfter), sessionIds(actorCredentialsBefore))
    } else {
      assert.lengthOf(actorCredentialsBefore.sessions, 0)
      assert.lengthOf(actorCredentialsAfter.sessions, 0)
    }

    const rejected = await accountKitRequest(actorLogin.client, business, actorLogin.credential)
    assert.equal(rejected.status, 409)
    assert.equal(await errorCode(rejected), 'E_MASQUERADE_CONTEXT_CHANGED')
    assert.equal(await latestOutcome(actor.id), 'actor_stamp')
  })

  test('a revoked current credential cannot start, use, or stop before mode reads, then relogin invalidates the actor stamp', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const actorLogin = await loginAccountKitUser(actor.email)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)
    const startedBody = (await started.json()) as { contextToken: string }
    const modeBeforeRevocation = await modeRow(actor.id)
    assert.equal(modeBeforeRevocation?.state, 'active')

    const { response: statusRead, modeQueries: statusModeQueries } = await captureModeQueries(() =>
      accountKitRequest(actorLogin.client, control, actorLogin.credential)
    )
    assert.equal(statusRead.status, 200)
    assert.isTrue(statusModeQueries.some((query) => /masquerade_modes/i.test(query)))

    // This public Kit operation advances the actor revision and revokes every current credential.
    const kit = await app.container.make(AccountKit)
    await kit.emailPasswordManagement.changePassword({
      actorId: actor.id,
      currentPassword: accountKitPassword,
      newPassword: accountKitNextPassword,
    })

    const requests = [
      () =>
        accountKitJson(
          actorLogin.client,
          `${control}/start`,
          actorLogin.credential,
          actorLogin.csrf,
          { targetId: target.id, reason: 'stale actor credential', access: 'edit' },
          { 'X-Masquerade-Context': startedBody.contextToken }
        ),
      () => accountKitRequest(actorLogin.client, business, actorLogin.credential),
      () =>
        accountKitJson(
          actorLogin.client,
          `${control}/stop`,
          actorLogin.credential,
          actorLogin.csrf,
          {},
          { 'X-Masquerade-Context': startedBody.contextToken }
        ),
    ]

    for (const request of requests) {
      const { response, modeQueries } = await captureModeQueries(request)
      assert.equal(response.status, 401)
      assert.deepEqual(modeQueries, [])
      assert.deepEqual(await modeRow(actor.id), modeBeforeRevocation)
    }

    const freshLogin = await loginAccountKitUser(actor.email, accountKitNextPassword)
    const freshStatus = await accountKitRequest(freshLogin.client, control, freshLogin.credential)
    assert.equal(freshStatus.status, 200)
    assert.isTrue(((await freshStatus.json()) as { isMasquerading: boolean }).isMasquerading)
    const afterRelogin = await modeRow(actor.id)
    assert.deepEqual(afterRelogin, modeBeforeRevocation)

    const rejected = await accountKitRequest(freshLogin.client, business, freshLogin.credential)
    assert.equal(rejected.status, 409)
    assert.equal(await errorCode(rejected), 'E_MASQUERADE_CONTEXT_CHANGED')
    assert.equal(await latestOutcome(actor.id), 'actor_stamp')
  })

  test('target sessions.revokeAll invalidates an otherwise eligible target stamp', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const targetBefore = await credentialFootprint(target.id)
    const actorLogin = await loginAccountKitUser(actor.email)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)

    const targetLogin = await loginAccountKitUser(target.email)
    const revoked = await accountKitJson(
      targetLogin.client,
      '/kit/account/sessions/revoke-all',
      targetLogin.credential,
      targetLogin.csrf,
      {}
    )
    assert.equal(revoked.status, 204)

    const rejected = await accountKitRequest(actorLogin.client, business, actorLogin.credential)
    assert.equal(rejected.status, 409)
    assert.equal(await errorCode(rejected), 'E_MASQUERADE_CONTEXT_CHANGED')
    assert.equal(await latestOutcome(actor.id), 'target_stamp')
    const row = await modeRow(actor.id)
    assert.equal(row?.state, 'idle')
    assert.isNull(row?.target_id)
    const targetAfter = await credentialFootprint(target.id)
    assert.notDeepEqual(targetAfter.credentialsChangedAt, targetBefore.credentialsChangedAt)
    assert.lengthOf(targetAfter.sessions, 0)
    assert.lengthOf(targetAfter.tokens, 0)
  }).skip(!sessionManagementEnabled, 'requires Account Kit sessionManagement')

  test('a restriction change that keeps target access eligible invalidates target stamp', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const targetBefore = await credentialFootprint(target.id)
    const kit = await app.container.make(AccountKit)
    const snapshotBefore = await kit.authentication.inspectAccountAccess({
      userId: target.id,
      requireActive: true,
    })
    assert.equal(snapshotBefore.account.active, true)

    const actorLogin = await loginAccountKitUser(actor.email)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)

    // This public restriction operation leaves the fixture's `active` access policy true.
    await kit.authentication.changeRestriction({
      userId: target.id,
      change: async (_user, trx) => {
        await trx.from('users').where('id', target.id).update({ active: true })
      },
    })
    const snapshotAfter = await kit.authentication.inspectAccountAccess({
      userId: target.id,
      requireActive: true,
    })
    assert.equal(snapshotAfter.account.active, true)
    assert.notDeepEqual(snapshotAfter.revision, snapshotBefore.revision)

    const rejected = await accountKitRequest(actorLogin.client, business, actorLogin.credential)
    assert.equal(rejected.status, 409)
    assert.equal(await errorCode(rejected), 'E_MASQUERADE_CONTEXT_CHANGED')
    assert.equal(await latestOutcome(actor.id), 'target_stamp')
    const targetAfter = await credentialFootprint(target.id)
    assert.notDeepEqual(targetAfter.credentialsChangedAt, targetBefore.credentialsChangedAt)
    assert.deepEqual(targetAfter.sessions, targetBefore.sessions)
    assert.deepEqual(targetAfter.tokens, targetBefore.tokens)
  })

  test('actor sessions.revokeAll rejects the old credential until relogin, then invalidates actor stamp', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const actorLogin = await loginAccountKitUser(actor.email)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)
    const startedBody = (await started.json()) as { contextToken: string }
    const modeBeforeRevocation = await modeRow(actor.id)
    const actorBefore = await credentialFootprint(actor.id)

    const revoked = await accountKitJson(
      actorLogin.client,
      '/account/sessions/revoke-all',
      actorLogin.credential,
      actorLogin.csrf,
      {}
    )
    assert.equal(revoked.status, 204)
    const actorAfter = await credentialFootprint(actor.id)
    assert.notDeepEqual(actorAfter.credentialsChangedAt, actorBefore.credentialsChangedAt)
    assert.lengthOf(actorAfter.sessions, 0)
    assert.lengthOf(actorAfter.tokens, 0)

    const requests = [
      () =>
        accountKitJson(
          actorLogin.client,
          `${control}/start`,
          actorLogin.credential,
          actorLogin.csrf,
          { targetId: target.id, reason: 'revoked actor credential', access: 'edit' },
          { 'X-Masquerade-Context': startedBody.contextToken }
        ),
      () => accountKitRequest(actorLogin.client, business, actorLogin.credential),
      () =>
        accountKitJson(
          actorLogin.client,
          `${control}/stop`,
          actorLogin.credential,
          actorLogin.csrf,
          {},
          { 'X-Masquerade-Context': startedBody.contextToken }
        ),
    ]
    for (const request of requests) {
      const { response, modeQueries } = await captureModeQueries(request)
      assert.equal(response.status, 401)
      assert.deepEqual(modeQueries, [])
      assert.deepEqual(await modeRow(actor.id), modeBeforeRevocation)
    }

    const freshLogin = await loginAccountKitUser(actor.email)
    const freshStatus = await accountKitRequest(freshLogin.client, control, freshLogin.credential)
    assert.equal(freshStatus.status, 200)
    assert.isTrue(((await freshStatus.json()) as { isMasquerading: boolean }).isMasquerading)
    assert.deepEqual(await modeRow(actor.id), modeBeforeRevocation)

    const rejected = await accountKitRequest(freshLogin.client, business, freshLogin.credential)
    assert.equal(rejected.status, 409)
    assert.equal(await errorCode(rejected), 'E_MASQUERADE_CONTEXT_CHANGED')
    assert.equal(await latestOutcome(actor.id), 'actor_stamp')
  }).skip(!sessionManagementEnabled, 'requires Account Kit sessionManagement')

  test('single-sign-in revocation preserves the active mode and remaining valid actor credential', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const actorLogin = await loginAccountKitUser(actor.email)
    const otherLogin = await loginAccountKitUser(actor.email)
    const signIns = await listSignIns(actorLogin.client, actorLogin.credential)
    assert.isAtLeast(signIns.length, 2)
    const otherId = signIns.find((signIn) => !signIn.current)?.id
    assert.isNumber(otherId)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)
    const modeBeforeRevoke = await modeRow(actor.id)
    const eventsBeforeRevoke = await actorEvents(actor.id)
    const revisionBeforeRevoke = (await credentialFootprint(actor.id)).credentialsChangedAt

    const revoked = await accountKitDelete(
      actorLogin.client,
      `/account/sessions/${otherId}`,
      actorLogin.credential,
      actorLogin.csrf
    )
    assert.equal(revoked.status, 200)
    assert.deepEqual(await modeRow(actor.id), modeBeforeRevoke)
    assert.deepEqual(await actorEvents(actor.id), eventsBeforeRevoke)
    assert.deepEqual(
      (await credentialFootprint(actor.id)).credentialsChangedAt,
      revisionBeforeRevoke
    )
    assert.equal(
      (await accountKitRequest(actorLogin.client, business, actorLogin.credential)).status,
      200
    )
    assert.equal(
      (await accountKitRequest(otherLogin.client, control, otherLogin.credential)).status,
      401
    )
  }).skip(!sessionManagementEnabled, 'requires Account Kit sessionManagement')

  test('revokeOthers preserves the active mode and current actor credential', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const actorLogin = await loginAccountKitUser(actor.email)
    const otherLogin = await loginAccountKitUser(actor.email)
    assert.isAtLeast((await listSignIns(actorLogin.client, actorLogin.credential)).length, 2)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)
    const modeBeforeRevoke = await modeRow(actor.id)
    const eventsBeforeRevoke = await actorEvents(actor.id)
    const revisionBeforeRevoke = (await credentialFootprint(actor.id)).credentialsChangedAt

    const revoked = await accountKitJson(
      actorLogin.client,
      '/account/sessions/revoke-others',
      actorLogin.credential,
      actorLogin.csrf,
      {}
    )
    assert.equal(revoked.status, 200)
    assert.deepEqual(await modeRow(actor.id), modeBeforeRevoke)
    assert.deepEqual(await actorEvents(actor.id), eventsBeforeRevoke)
    assert.deepEqual(
      (await credentialFootprint(actor.id)).credentialsChangedAt,
      revisionBeforeRevoke
    )
    assert.equal(
      (await accountKitRequest(actorLogin.client, business, actorLogin.credential)).status,
      200
    )
    assert.equal(
      (await accountKitRequest(otherLogin.client, control, otherLogin.credential)).status,
      401
    )
  }).skip(!sessionManagementEnabled, 'requires Account Kit sessionManagement')

  test('logout ends one credential without changing the revision or clearing active mode', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const actorLogin = await loginAccountKitUser(actor.email)
    const otherLogin = await loginAccountKitUser(actor.email)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)
    const modeBeforeLogout = await modeRow(actor.id)
    const eventsBeforeLogout = await actorEvents(actor.id)
    const revisionBeforeLogout = (await credentialFootprint(actor.id)).credentialsChangedAt

    const loggedOut = await accountKitJson(
      otherLogin.client,
      '/kit/account/logout',
      otherLogin.credential,
      otherLogin.csrf,
      {}
    )
    assert.equal(loggedOut.status, 204)
    assert.deepEqual(await modeRow(actor.id), modeBeforeLogout)
    assert.deepEqual(await actorEvents(actor.id), eventsBeforeLogout)
    assert.deepEqual(
      (await credentialFootprint(actor.id)).credentialsChangedAt,
      revisionBeforeLogout
    )
    assert.equal(
      (await accountKitRequest(actorLogin.client, business, actorLogin.credential)).status,
      200
    )
    assert.equal(
      (await accountKitRequest(otherLogin.client, control, otherLogin.credential)).status,
      401
    )
  })

  test('an ended session handle cannot start, use, or stop before mode reads', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const actorLogin = await loginAccountKitUser(actor.email)
    const otherLogin = await loginAccountKitUser(actor.email)
    const signIns = await listSignIns(actorLogin.client, actorLogin.credential)
    const currentId = signIns.find((signIn) => signIn.current)?.id
    assert.isNumber(currentId)
    const idle = await accountKitRequest(actorLogin.client, control, actorLogin.credential)
    assert.equal(idle.status, 200)
    const idleBody = (await idle.json()) as { contextToken: string }
    const started = await startMode(
      actorLogin.client,
      actorLogin.credential,
      actorLogin.csrf,
      idleBody.contextToken,
      target.id
    )
    assert.equal(started.status, 200)
    const startedBody = (await started.json()) as { contextToken: string }
    const modeBeforeEnd = await modeRow(actor.id)

    const ended = await accountKitDelete(
      otherLogin.client,
      `/account/sessions/${currentId}`,
      otherLogin.credential,
      otherLogin.csrf
    )
    assert.equal(ended.status, 200)
    assert.deepEqual(await modeRow(actor.id), modeBeforeEnd)

    const requests = [
      () =>
        accountKitJson(
          actorLogin.client,
          `${control}/start`,
          actorLogin.credential,
          actorLogin.csrf,
          { targetId: target.id, reason: 'ended session handle', access: 'edit' },
          { 'X-Masquerade-Context': startedBody.contextToken }
        ),
      () => accountKitRequest(actorLogin.client, business, actorLogin.credential),
      () =>
        accountKitJson(
          actorLogin.client,
          `${control}/stop`,
          actorLogin.credential,
          actorLogin.csrf,
          {},
          { 'X-Masquerade-Context': startedBody.contextToken }
        ),
    ]
    for (const request of requests) {
      const { response, modeQueries } = await captureModeQueries(request)
      assert.equal(response.status, 401)
      assert.deepEqual(modeQueries, [])
      assert.deepEqual(await modeRow(actor.id), modeBeforeEnd)
    }
    assert.equal(
      (await accountKitRequest(otherLogin.client, business, otherLogin.credential)).status,
      200
    )
  }).skip(
    !sessionManagementEnabled || process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens',
    'requires session guard with Account Kit sessionManagement'
  )
})

async function startMode(
  client: AccountKitHttp,
  credential: string,
  csrf: string,
  contextToken: string,
  targetId: number
) {
  return accountKitJson(
    client,
    `${control}/start`,
    credential,
    csrf,
    { targetId, reason: 'Account Kit credential acceptance', access: 'edit' },
    { 'X-Masquerade-Context': contextToken }
  )
}

async function errorCode(response: Response) {
  const body = (await response.json()) as { errors?: Array<{ code?: string }> }
  return body.errors?.[0]?.code
}

async function credentialFootprint(userId: number) {
  const user = await db.from('users').select('credentials_changed_at').where('id', userId).first()
  const schema = db.connection().schema
  const sessions = (await schema.hasTable('account_sessions'))
    ? await db.from('account_sessions').where('user_id', userId).orderBy('id')
    : []
  const tokens = (await schema.hasTable('auth_access_tokens'))
    ? await db.from('auth_access_tokens').where('tokenable_id', userId).orderBy('id')
    : []
  return { credentialsChangedAt: user?.credentials_changed_at ?? null, sessions, tokens }
}

async function modeRow(actorId: number) {
  return db.from('masquerade_modes').where('actor_id', String(actorId)).first()
}

async function latestOutcome(actorId: number) {
  const event = await latestEvent(actorId)
  return event?.outcome_code
}

async function latestEvent(actorId: number) {
  return db
    .from('masquerade_events')
    .where('actor_id', String(actorId))
    .orderBy('at', 'desc')
    .orderBy('id', 'desc')
    .first()
}

async function actorEvents(actorId: number) {
  return db
    .from('masquerade_events')
    .where('actor_id', String(actorId))
    .orderBy('at', 'asc')
    .orderBy('id', 'asc')
}

async function listSignIns(client: AccountKitHttp, credential: string) {
  const response = await accountKitRequest(client, '/kit/account/sessions', credential)
  if (response.status !== 200)
    throw new Error(
      `Account Kit session list returned ${response.status}: ${await response.text()}`
    )
  const body = (await response.json()) as { sessions: Array<{ id: number; current: boolean }> }
  return body.sessions
}

function sessionIds(footprint: Awaited<ReturnType<typeof credentialFootprint>>) {
  return footprint.sessions.map((session: { id: number }) => session.id).sort()
}

function tokenIds(footprint: Awaited<ReturnType<typeof credentialFootprint>>) {
  return footprint.tokens.map((token: { id: number }) => token.id).sort()
}

async function captureModeQueries<T>(run: () => Promise<T>) {
  const client = db.connection().getWriteClient()
  const modeQueries: string[] = []
  const listener = (query: { sql: string }) => {
    if (/masquerade_(?:modes|events)/i.test(query.sql)) modeQueries.push(query.sql)
  }
  client.on('query', listener)
  try {
    return { response: await run(), modeQueries }
  } finally {
    client.removeListener('query', listener)
  }
}
