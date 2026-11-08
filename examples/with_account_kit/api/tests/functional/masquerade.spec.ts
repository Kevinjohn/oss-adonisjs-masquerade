import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { masqueradeOperatorEmails } from '#services/masquerade_operators'
import { grantAdmission } from '#tests/helpers/admission'
import { responseBody } from '#tests/helpers/response_body'
import { truncateDatabase } from '#tests/helpers/database'

type ModeView = {
  isMasquerading: boolean
  contextToken: string
}

async function createAdmittedUser(email: string, password: string) {
  const user = await User.create({
    fullName: email.split('@')[0],
    email,
    password,
    emailVerifiedAt: DateTime.utc(),
  })
  await grantAdmission(user)
  return user
}

async function login(client: ApiClient, email: string, password: string) {
  const response = await client.post('/api/v1/auth/login').json({ email, password })
  response.assertStatus(200)
  return responseBody<{ data: { token: string } }>(response).data.token
}

test.group('Masquerade HTTP API', (group) => {
  group.each.setup(truncateDatabase)
  group.each.setup(async () => {
    const originalOperators = [...masqueradeOperatorEmails]
    masqueradeOperatorEmails.clear()
    return () => {
      masqueradeOperatorEmails.clear()
      for (const email of originalOperators) masqueradeOperatorEmails.add(email)
    }
  })

  test('operator starts and stops masquerade while keeping the actor authenticated', async ({
    client,
    assert,
  }) => {
    const actor = await createAdmittedUser('operator@example.test', 'OperatorPass123!')
    const target = await createAdmittedUser('target@example.test', 'TargetPass123!')
    masqueradeOperatorEmails.add(actor.email)

    const actorToken = await login(client, actor.email, 'OperatorPass123!')
    const initialStatus = await client.get('/masquerade').bearerToken(actorToken)
    assert.equal(initialStatus.status(), 200)
    const initialMode = responseBody<ModeView>(initialStatus)
    assert.isFalse(initialMode.isMasquerading)

    const idleSensitive = await client
      .post('/api/v1/masquerade/sensitive')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', initialMode.contextToken)
    assert.equal(idleSensitive.status(), 200)
    assert.deepEqual(idleSensitive.body(), { allowed: true })

    const started = await client
      .post('/masquerade/start')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', initialMode.contextToken)
      .json({ targetId: String(target.id) })
    assert.equal(started.status(), 200)

    const activeStatus = await client.get('/masquerade').bearerToken(actorToken)
    assert.equal(activeStatus.status(), 200)
    const activeMode = responseBody<ModeView>(activeStatus)
    assert.isTrue(activeMode.isMasquerading)
    assert.isString(activeMode.contextToken)
    assert.notEqual(activeMode.contextToken, initialMode.contextToken)

    const effectiveAccount = await client
      .get('/api/v1/masquerade/account')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', activeMode.contextToken)
    assert.equal(effectiveAccount.status(), 200)
    assert.deepEqual(effectiveAccount.body(), { id: target.id, email: target.email })

    const blockedSensitive = await client
      .post('/api/v1/masquerade/sensitive')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', activeMode.contextToken)
    assert.equal(blockedSensitive.status(), 403)
    assert.deepEqual(responseBody<{ errors: [Record<string, string>] }>(blockedSensitive).errors, [
      {
        code: 'E_MASQUERADE_ACTION_BLOCKED',
        message: 'Action is blocked while masquerading',
        blockedBy: 'sensitive',
      },
    ])

    const stopped = await client
      .post('/masquerade/stop')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', activeMode.contextToken)
    assert.equal(stopped.status(), 200)

    const restoredAccount = await client.get('/api/v1/masquerade/account').bearerToken(actorToken)
    assert.equal(restoredAccount.status(), 200)
    assert.deepEqual(restoredAccount.body(), { id: actor.id, email: actor.email })

    const stoppedStatus = await client.get('/masquerade').bearerToken(actorToken)
    assert.isFalse(responseBody<ModeView>(stoppedStatus).isMasquerading)
  })

  test('non-operator cannot start masquerade and creates no active mode', async ({
    client,
    assert,
  }) => {
    const actor = await createAdmittedUser('member@example.test', 'MemberPass123!')
    const target = await createAdmittedUser('other-member@example.test', 'OtherPass123!')
    const actorToken = await login(client, actor.email, 'MemberPass123!')
    const mode = responseBody<ModeView>(await client.get('/masquerade').bearerToken(actorToken))

    const refused = await client
      .post('/masquerade/start')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', mode.contextToken)
      .json({ targetId: String(target.id) })

    assert.equal(refused.status(), 403)
    assert.equal(
      responseBody<{ errors: [{ code: string }] }>(refused).errors[0].code,
      'E_MASQUERADE_NOT_ALLOWED'
    )
    assert.isFalse(
      responseBody<ModeView>(await client.get('/masquerade').bearerToken(actorToken)).isMasquerading
    )
    assert.lengthOf(await db.from('masquerade_modes').where('state', 'active'), 0)
  })

  test('operator cannot masquerade as another operator and creates no active mode', async ({
    client,
    assert,
  }) => {
    const actor = await createAdmittedUser('first-operator@example.test', 'FirstPass123!')
    const target = await createAdmittedUser('second-operator@example.test', 'SecondPass123!')
    masqueradeOperatorEmails.add(actor.email)
    masqueradeOperatorEmails.add(target.email)

    const actorToken = await login(client, actor.email, 'FirstPass123!')
    const mode = responseBody<ModeView>(await client.get('/masquerade').bearerToken(actorToken))
    const refused = await client
      .post('/masquerade/start')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', mode.contextToken)
      .json({ targetId: String(target.id) })

    assert.equal(refused.status(), 403)
    assert.equal(
      responseBody<{ errors: [{ code: string }] }>(refused).errors[0].code,
      'E_MASQUERADE_NOT_ALLOWED'
    )
    assert.isFalse(
      responseBody<ModeView>(await client.get('/masquerade').bearerToken(actorToken)).isMasquerading
    )
    assert.lengthOf(await db.from('masquerade_modes').where('state', 'active'), 0)
  })

  test('operator cannot start masquerade as a user without admission', async ({
    client,
    assert,
  }) => {
    const actor = await createAdmittedUser('operator@example.test', 'OperatorPass123!')
    const target = await User.create({
      fullName: 'Unadmitted Target',
      email: 'unadmitted@example.test',
      password: 'TargetPass123!',
      emailVerifiedAt: DateTime.utc(),
    })
    masqueradeOperatorEmails.add(actor.email)

    const actorToken = await login(client, actor.email, 'OperatorPass123!')
    const mode = responseBody<ModeView>(await client.get('/masquerade').bearerToken(actorToken))
    const refused = await client
      .post('/masquerade/start')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', mode.contextToken)
      .json({ targetId: String(target.id) })

    assert.equal(refused.status(), 403)
    assert.equal(
      responseBody<{ errors: [{ code: string }] }>(refused).errors[0].code,
      'E_MASQUERADE_NOT_ALLOWED'
    )
    assert.lengthOf(await db.from('masquerade_modes').where('state', 'active'), 0)
  })

  test('revoked actor admission blocks effective requests without changing active mode', async ({
    client,
    assert,
  }) => {
    const actor = await createAdmittedUser('operator@example.test', 'OperatorPass123!')
    const target = await createAdmittedUser('target@example.test', 'TargetPass123!')
    masqueradeOperatorEmails.add(actor.email)

    const actorToken = await login(client, actor.email, 'OperatorPass123!')
    const initialMode = responseBody<ModeView>(
      await client.get('/masquerade').bearerToken(actorToken)
    )
    const started = await client
      .post('/masquerade/start')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', initialMode.contextToken)
      .json({ targetId: String(target.id) })
    assert.equal(started.status(), 200)
    const activeMode = responseBody<ModeView>(
      await client.get('/masquerade').bearerToken(actorToken)
    )
    const modeBeforeRevocation = await db
      .from('masquerade_modes')
      .where('actor_id', String(actor.id))
      .where('state', 'active')
      .first()
    assert.isNotNull(modeBeforeRevocation)

    await db
      .from('account_admissions')
      .where('user_id', actor.id)
      .update({ approval_status: 'revoked' })

    const refused = await client
      .get('/api/v1/masquerade/account')
      .bearerToken(actorToken)
      .header('X-Masquerade-Context', activeMode.contextToken)
    assert.equal(refused.status(), 403)
    assert.equal(
      responseBody<{ errors: [{ code: string }] }>(refused).errors[0].code,
      'E_ACCOUNT_KIT_ADMISSION_REQUIRED'
    )

    const modeAfterRevocation = await db
      .from('masquerade_modes')
      .where('actor_id', String(actor.id))
      .where('state', 'active')
      .first()
    assert.deepEqual(modeAfterRevocation, modeBeforeRevocation)
  })

  test('token without masquerade ability can still use the profile API', async ({
    client,
    assert,
  }) => {
    const actor = await createAdmittedUser('operator@example.test', 'OperatorPass123!')
    masqueradeOperatorEmails.add(actor.email)
    const token = await User.accessTokens.create(actor, ['profile:read'], { expiresIn: '1d' })
    const value = token.value!.release()

    const profile = await client.get('/api/v1/account/profile').bearerToken(value)
    assert.equal(profile.status(), 200)

    const refused = await client.get('/masquerade').bearerToken(value)
    assert.equal(refused.status(), 403)
    assert.equal(
      responseBody<{ errors: [{ code: string }] }>(refused).errors[0].code,
      'E_MASQUERADE_NOT_ALLOWED'
    )
  })
})
