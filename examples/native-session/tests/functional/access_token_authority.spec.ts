import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { cleanUsers, createAccessToken, createUsers } from '#tests/helpers/users'
import User from '#models/user'
import {
  masqueradeFixtureDiagnostics,
  resetMasqueradeReadCount,
  setAuthorityCallbacksThrow,
} from '#services/masquerade_fixture_boundary'

test.group('native access-token authority', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanUsers())

  test('bearer requests in a view mode are blocked with view_only', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)
    const idle = await status(client, value)
    idle.assertStatus(200)
    const started = await client
      .post('/api/masquerade/start')
      .header('Authorization', bearer(value))
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', idle.body().contextToken)
      .json({ targetId: target.id, reason: 'Read-only token review' })
    started.assertStatus(200)
    assert.equal(started.body().access, 'view')

    const blocked = await client
      .post('/api/business/mutate')
      .header('Authorization', bearer(value))
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', started.body().contextToken)
      .json({})
    blocked.assertStatus(403)
    assert.equal(blocked.body().errors[0].code, 'E_MASQUERADE_ACTION_BLOCKED')
    assert.equal(blocked.body().errors[0].blockedBy, 'view_only')
  })

  test('uses an opaque token for idle, status, start, effective reads, mutation and stop', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const { token, value } = await createAccessToken(actor)
    const [credentialBefore] = await db
      .from('auth_access_tokens')
      .where('id', String(token.identifier))
      .select('id', 'hash', 'expires_at')
    const beforeCount = await db
      .from('auth_access_tokens')
      .where('tokenable_id', actor.id)
      .count('* as total')

    const idle = await business(client, value)
    idle.assertStatus(200)
    idle.assertBodyContains({
      actorId: actor.id,
      effectiveId: actor.id,
      getUserOrFailId: actor.id,
      authenticatedViaGuard: 'api_effective',
      rawActorId: actor.id,
      bouncerUserId: actor.id,
      silentAuthSnapshot: { guard: 'web_effective', userId: actor.id },
      actorHasCurrentAccessToken: true,
      actorCurrentAccessTokenId: token.identifier,
      effectiveHasCurrentAccessToken: true,
    })

    const idleStatus = await status(client, value)
    idleStatus.assertStatus(200)
    const started = await start(client, value, target.id, idleStatus.body().contextToken)
    started.assertStatus(200)
    started.assertHeader('cache-control', 'no-store')
    const activeContext = started.body().contextToken as string

    const active = await business(client, value)
    active.assertBodyContains({
      actorId: actor.id,
      effectiveId: target.id,
      getUserOrFailId: target.id,
      authenticatedViaGuard: 'api_effective',
      rawActorId: actor.id,
      bouncerUserId: target.id,
      silentAuthSnapshot: { guard: 'web_effective', userId: target.id },
      actorHasCurrentAccessToken: true,
      actorCurrentAccessTokenId: token.identifier,
      effectiveHasCurrentAccessToken: false,
    })
    const allowed = await mutate(client, value, activeContext)
    allowed.assertStatus(200)
    allowed.assertBodyContains({ effectiveId: target.id })
    const sensitive = await client
      .post('/api/business/sensitive')
      .header('Authorization', bearer(value))
      .header('X-Masquerade-Context', activeContext)
      .json({})
    sensitive.assertStatus(403)

    const countAfterJourney = await db
      .from('auth_access_tokens')
      .where('tokenable_id', actor.id)
      .count('* as total')
    assert.equal(Number(countAfterJourney[0].total), Number(beforeCount[0].total))
    const targetTokenCount = await db
      .from('auth_access_tokens')
      .where('tokenable_id', target.id)
      .count('* as total')
    assert.equal(Number(targetTokenCount[0].total), 0)
    const [credentialAfter] = await db
      .from('auth_access_tokens')
      .where('id', String(token.identifier))
      .select('id', 'hash', 'expires_at')
    assert.equal(credentialAfter.id, credentialBefore.id)
    assert.equal(credentialAfter.hash, credentialBefore.hash)
    assert.equal(
      new Date(credentialAfter.expires_at).getTime(),
      new Date(credentialBefore.expires_at).getTime()
    )

    actor.masqueradeOperator = false
    await actor.save()
    const stopped = await stop(client, value, activeContext)
    stopped.assertStatus(200)
    const after = await business(client, value)
    after.assertBodyContains({ effectiveId: actor.id, rawActorId: actor.id })
  })

  test('shares account mode with sessions in both directions', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)

    const sessionIdle = await client.get('/masquerade').loginAs(actor)
    sessionIdle.assertStatus(200)
    const startedBySession = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', sessionIdle.body().contextToken)
      .json({ targetId: target.id, reason: 'session to token acceptance' })
      .loginAs(actor)
    startedBySession.assertStatus(200)
    const sessionContext = startedBySession.body().contextToken as string
    const tokenSees = await status(client, value)
    assert.equal(tokenSees.body().isMasquerading, true)
    assert.equal(tokenSees.body().targetId, String(target.id))
    const tokenStops = await stop(client, value, sessionContext)
    tokenStops.assertStatus(200)

    const tokenIdle = await status(client, value)
    const startedByToken = await start(client, value, target.id, tokenIdle.body().contextToken)
    startedByToken.assertStatus(200)
    const tokenContext = startedByToken.body().contextToken as string
    const sessionSees = await client.get('/masquerade').loginAs(actor)
    assert.equal(sessionSees.body().isMasquerading, true)
    assert.equal(sessionSees.body().targetId, String(target.id))
    const sessionStops = await client
      .post('/masquerade/stop')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', tokenContext)
      .json({})
      .loginAs(actor)
    sessionStops.assertStatus(200)
  })

  test('preserves an active account mode when its token is revoked', async ({ client, assert }) => {
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)
    const idle = await status(client, value)
    const started = await start(client, value, target.id, idle.body().contextToken)
    started.assertStatus(200)

    resetMasqueradeReadCount()
    const logout = await client.post('/api/logout').header('Authorization', bearer(value)).json({})
    logout.assertStatus(200)
    logout.assertBodyContains({ loggedOut: true })
    assert.equal(masqueradeFixtureDiagnostics().modeReads, 0)

    const revokedStatus = await status(client, value)
    revokedStatus.assertStatus(401)

    const sessionStatus = await client.get('/masquerade').loginAs(actor)
    sessionStatus.assertBodyContains({ isMasquerading: true, targetId: String(target.id) })
    const sessionStop = await client
      .post('/masquerade/stop')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', started.body().contextToken)
      .json({})
      .loginAs(actor)
    sessionStop.assertStatus(200)
  })

  test('allows token stop after policy denial, target deletion and actor stamp change', async ({
    client,
  }) => {
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)
    const idle = await status(client, value)
    const started = await start(client, value, target.id, idle.body().contextToken)
    started.assertStatus(200)

    actor.masqueradeOperator = false
    actor.securityStamp = 'actor-v2'
    await actor.save()
    await target.delete()

    const stopped = await stop(client, value, started.body().contextToken)
    stopped.assertStatus(200)
    const after = await status(client, value)
    after.assertBodyContains({ isMasquerading: false })
  })

  test('stops with a token while authority stamp and policy callbacks throw', async ({
    client,
  }) => {
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)
    const idle = await status(client, value)
    const started = await start(client, value, target.id, idle.body().contextToken)
    started.assertStatus(200)

    setAuthorityCallbacksThrow(true)
    try {
      const stopped = await stop(client, value, started.body().contextToken)
      stopped.assertStatus(200)
    } finally {
      setAuthorityCallbacksThrow(false)
    }
  })

  test('serializes concurrent session and token starts from one idle context', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)
    const idle = await status(client, value)
    const contextToken = idle.body().contextToken as string

    const sessionStart = client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', contextToken)
      .json({ targetId: target.id, reason: 'concurrent session start' })
      .loginAs(actor)
    const tokenStart = start(client, value, target.id, contextToken)
    const [sessionResult, tokenResult] = await Promise.all([sessionStart, tokenStart])
    assert.deepEqual([sessionResult.status(), tokenResult.status()].sort(), [200, 409])
    const sessionStatus = await client.get('/masquerade').loginAs(actor)
    sessionStatus.assertBodyContains({ isMasquerading: true, targetId: String(target.id) })
  })

  test('invalidates token admission after the actor security stamp changes', async ({ client }) => {
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)
    const idle = await status(client, value)
    const started = await start(client, value, target.id, idle.body().contextToken)
    started.assertStatus(200)

    actor.securityStamp = 'actor-v2'
    await actor.save()
    const deniedAdmission = await business(client, value)
    deniedAdmission.assertStatus(409)
    const idleAgain = await status(client, value)
    idleAgain.assertBodyContains({ isMasquerading: false })
  })

  test('requires the configured ability before touching account mode while raw token routes remain actor routes', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const { value: validValue } = await createAccessToken(actor)
    const { value: restrictedValue } = await createAccessToken(actor, ['read:profile'])
    resetMasqueradeReadCount()
    const idleAuditBefore = await eventCount(actor.id)
    const idleDeniedStatus = await status(client, restrictedValue)
    idleDeniedStatus.assertStatus(403)
    const idleDeniedStart = await start(client, restrictedValue, target.id, '1.abcdef')
    idleDeniedStart.assertStatus(403)
    const idleDeniedBusiness = await business(client, restrictedValue)
    idleDeniedBusiness.assertStatus(403)
    assert.equal(masqueradeFixtureDiagnostics().modeReads, 0)
    assert.equal(await eventCount(actor.id), idleAuditBefore)

    const idle = await status(client, validValue)
    const started = await start(client, validValue, target.id, idle.body().contextToken)
    started.assertStatus(200)
    resetMasqueradeReadCount()
    const auditBefore = await eventCount(actor.id)

    const deniedStatus = await status(client, restrictedValue)
    deniedStatus.assertStatus(403)
    assert.equal(deniedStatus.body().errors[0].code, 'E_MASQUERADE_NOT_ALLOWED')
    const deniedBusiness = await business(client, restrictedValue)
    deniedBusiness.assertStatus(403)
    const deniedStop = await stop(client, restrictedValue, started.body().contextToken)
    deniedStop.assertStatus(403)
    assert.equal(masqueradeFixtureDiagnostics().modeReads, 0)
    assert.equal(await eventCount(actor.id), auditBefore)

    const rawBusiness = await client
      .get('/api/raw-business')
      .header('Authorization', bearer(restrictedValue))
    rawBusiness.assertStatus(200)
    rawBusiness.assertBodyContains({ actorId: actor.id })
  })

  test('keeps native 401 behavior for malformed, revoked and expired credentials without cookie fallback', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const valid = await createAccessToken(actor)
    const revoked = await createAccessToken(actor)
    await User.accessTokens.invalidate(revoked.token.value!)
    const expired = await createAccessToken(actor)
    await db
      .from('auth_access_tokens')
      .where('id', String(expired.token.identifier))
      .update({ expires_at: new Date(Date.now() - 60_000) })
    const idle = await status(client, valid.value)
    const auditBefore = await eventCount(actor.id)

    for (const credential of ['not-a-token', revoked.value, expired.value]) {
      const response = await client
        .post('/api/masquerade/start')
        .header('Authorization', bearer(credential))
        .withCsrfToken()
        .json({ targetId: target.id, reason: 'invalid token' })
        .loginAs(actor)
      response.assertStatus(401)
    }
    assert.equal(await eventCount(actor.id), auditBefore)
    const stillIdle = await status(client, valid.value)
    assert.equal(stillIdle.body().isMasquerading, false)
    assert.equal(stillIdle.body().contextToken, idle.body().contextToken)

    const missingBearer = await client.get('/api/masquerade').loginAs(actor)
    missingBearer.assertStatus(401)

    const deletedOwner = await createUsers()
    const deletedOwnerToken = await createAccessToken(deletedOwner.actor)
    await deletedOwner.actor.delete()
    const deletedOwnerResponse = await client
      .get('/api/masquerade')
      .header('Authorization', bearer(deletedOwnerToken.value))
    deletedOwnerResponse.assertStatus(401)
  })

  test('uses the explicitly selected bearer actor when cookie and bearer actors conflict', async ({
    client,
    assert,
  }) => {
    const first = await createUsers()
    const second = await createUsers()
    const secondToken = await createAccessToken(second.actor)

    const firstSessionStatus = await client.get('/masquerade').loginAs(first.actor)
    const secondTokenStatus = await status(client, secondToken.value)
    const selectedTokenStatus = await status(client, secondToken.value).loginAs(first.actor)
    selectedTokenStatus.assertStatus(200)
    assert.equal(selectedTokenStatus.body().contextToken, secondTokenStatus.body().contextToken)
    assert.notEqual(selectedTokenStatus.body().contextToken, firstSessionStatus.body().contextToken)

    const selectedBearer = await business(client, secondToken.value).loginAs(first.actor)
    selectedBearer.assertStatus(200)
    selectedBearer.assertBodyContains({ actorId: second.actor.id, effectiveId: second.actor.id })

    const tokenStart = await start(
      client,
      secondToken.value,
      second.target.id,
      secondTokenStatus.body().contextToken
    ).loginAs(first.actor)
    tokenStart.assertStatus(200)
    const firstStillIdle = await client.get('/masquerade').loginAs(first.actor)
    firstStillIdle.assertBodyContains({ isMasquerading: false })
    const tokenStillActive = await business(client, secondToken.value)
    tokenStillActive.assertBodyContains({ effectiveId: second.target.id })

    const firstStart = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('Authorization', bearer(secondToken.value))
      .header('X-Masquerade-Context', firstSessionStatus.body().contextToken)
      .json({ targetId: first.target.id, reason: 'explicit session control' })
      .loginAs(first.actor)
    firstStart.assertStatus(200)
    const secondStillActive = await business(client, secondToken.value)
    secondStillActive.assertBodyContains({ effectiveId: second.target.id })
    const firstNowActive = await client.get('/business').loginAs(first.actor)
    firstNowActive.assertBodyContains({ effectiveId: first.target.id })

    const insufficient = await createAccessToken(second.actor, ['read:profile'])
    const denied = await status(client, insufficient.value).loginAs(first.actor)
    denied.assertStatus(403)
    const invalid = await client
      .get('/api/masquerade')
      .header('Authorization', bearer('invalid'))
      .loginAs(first.actor)
    invalid.assertStatus(401)
  })

  test('enforces token context ownership and missing or stale mutation context', async ({
    client,
    assert,
  }) => {
    const first = await createUsers()
    const second = await createUsers()
    const firstToken = await createAccessToken(first.actor)
    const secondToken = await createAccessToken(second.actor)
    const idle = await status(client, firstToken.value)

    const missing = await mutate(client, firstToken.value)
    missing.assertStatus(428)
    assert.equal(missing.body().errors[0].code, 'E_MASQUERADE_CONTEXT_REQUIRED')
    const secondIdle = await status(client, secondToken.value)
    const wrongOwner = await mutate(client, firstToken.value, secondIdle.body().contextToken)
    wrongOwner.assertStatus(409)
    const started = await start(client, firstToken.value, first.target.id, idle.body().contextToken)
    started.assertStatus(200)
    const stale = await mutate(client, firstToken.value, idle.body().contextToken)
    stale.assertStatus(409)
    const otherAccount = await status(client, secondToken.value)
    assert.notEqual(otherAccount.body().contextToken, idle.body().contextToken)
  })

  test('accepts native wildcard ability semantics', async ({ client }) => {
    const { actor } = await createUsers()
    const { value } = await createAccessToken(actor, ['*'])
    const idle = await status(client, value)
    idle.assertStatus(200)
  })
})

function bearer(value: string) {
  return `Bearer ${value}`
}

function status(client: ApiClient, token: string) {
  return client.get('/api/masquerade').header('Authorization', bearer(token))
}

function business(client: ApiClient, token: string) {
  return client.get('/api/business').header('Authorization', bearer(token))
}

function start(client: ApiClient, token: string, targetId: number, contextToken: string) {
  return client
    .post('/api/masquerade/start')
    .header('Accept', 'application/json')
    .header('Authorization', bearer(token))
    .header('X-Masquerade-Context', contextToken)
    .json({ targetId, reason: 'token acceptance journey', access: 'edit' })
}

function stop(client: ApiClient, token: string, contextToken: string) {
  return client
    .post('/api/masquerade/stop')
    .header('Accept', 'application/json')
    .header('Authorization', bearer(token))
    .header('X-Masquerade-Context', contextToken)
    .json({})
}

function mutate(client: ApiClient, token: string, contextToken?: string) {
  let request = client.post('/api/business/mutate').header('Authorization', bearer(token)).json({})
  if (contextToken) request = request.header('X-Masquerade-Context', contextToken)
  return request
}

async function eventCount(actorId: number) {
  const rows = await db
    .from('masquerade_events')
    .where('actor_id', String(actorId))
    .count('* as total')
  return Number(rows[0].total)
}
