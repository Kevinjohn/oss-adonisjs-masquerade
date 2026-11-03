import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import emitter from '@adonisjs/core/services/emitter'
import type { SessionGuardEvents } from '@adonisjs/auth/types/session'
import {
  masqueradeFixtureDiagnostics,
  resetMasqueradeReadCount,
  resetMasqueradeFixtureDiagnostics,
  setMasqueradeStoreUnavailable,
} from '#services/masquerade_fixture_boundary'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import type User from '#models/user'
import { createHash } from 'node:crypto'

declare module '@adonisjs/core/types' {
  interface EventsList extends SessionGuardEvents<User> {}
}

test.group('real HTTP masquerade context and actions', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(async () => {
    await limiter.clear(['memory'])
    setMasqueradeStoreUnavailable(false)
    await cleanUsers()
  })

  test('issues owner-specific idle tokens and denies missing, malformed, and query-only contexts', async ({
    client,
    assert,
  }) => {
    const first = await createUsers()
    const second = await createUsers()
    const firstStatus = await status(client, first.actor)
    const repeatedFirstStatus = await status(client, first.actor)
    const secondStatus = await status(client, second.actor)
    const firstToken = firstStatus.contextToken
    const secondToken = secondStatus.contextToken
    assert.equal(repeatedFirstStatus.contextToken, firstToken)
    assert.match(firstToken, /^[0-9]+\.[a-f0-9]+$/)
    assert.notEqual(firstToken, secondToken)

    const missing = await mutation(client, first.actor)
    missing.assertStatus(428)
    assert.equal(missing.body().errors[0].code, 'E_MASQUERADE_CONTEXT_REQUIRED')
    const malformed = await mutation(client, first.actor).header(
      'X-Masquerade-Context',
      'bad-token'
    )
    malformed.assertStatus(428)
    const wrongNamespace = idleTokenFor('another-namespace', first.actor.id)
    const namespaceMismatch = await mutation(client, first.actor, wrongNamespace)
    namespaceMismatch.assertStatus(409)
    const queryOnly = await client
      .post('/business/mutate?_masqueradeContext=' + encodeURIComponent(firstToken))
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({})
      .loginAs(first.actor)
    queryOnly.assertStatus(428)
    const urlEncodedStart = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .form({
        targetId: String(first.target.id),
        reason: 'urlencoded control request',
        _masqueradeContext: firstToken,
      })
      .loginAs(first.actor)
    urlEncodedStart.assertStatus(200)
    assert.equal(urlEncodedStart.body().targetId, first.target.id)
    const activeToken = urlEncodedStart.body().contextToken as string
    const stop = await client
      .post('/masquerade/stop')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', activeToken)
      .json({})
      .loginAs(first.actor)
    stop.assertStatus(200)
    const idleAgain = await status(client, first.actor)
    assert.notEqual(idleAgain.contextToken, firstToken)
    const staleActiveToken = await mutation(client, first.actor, activeToken)
    staleActiveToken.assertStatus(409)
    const revived = await startMode(client, first.actor, first.target.id, idleAgain.contextToken)
    revived.assertStatus(200)
    assert.notEqual(revived.body().contextToken, activeToken)
  })

  test('rejects cross-owner and conflicting header/form context tokens', async ({
    client,
    assert,
  }) => {
    const first = await createUsers()
    const second = await createUsers()
    const firstStatus = await status(client, first.actor)
    const secondStatus = await status(client, second.actor)
    const firstToken = firstStatus.contextToken
    const secondToken = secondStatus.contextToken

    const wrongOwner = await mutation(client, first.actor).header(
      'X-Masquerade-Context',
      secondToken
    )
    wrongOwner.assertStatus(409)
    assert.equal(wrongOwner.body().errors[0].code, 'E_MASQUERADE_CONTEXT_CHANGED')
    const conflict = await client
      .post('/business/mutate')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', firstToken)
      .json({ _masqueradeContext: secondToken })
      .loginAs(first.actor)
    conflict.assertStatus(409)
  })

  test('applies the host operator policy when starting from an idle actor context', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    actor.masqueradeOperator = false
    await actor.save()
    const idleStatus = await status(client, actor)
    const denied = await startMode(client, actor, target.id, idleStatus.contextToken)
    denied.assertStatus(403)
    assert.equal(denied.body().errors[0].code, 'E_MASQUERADE_NOT_ALLOWED')
    denied.assertHeader('cache-control', 'no-store')
    const unchanged = await status(client, actor)
    assert.equal(unchanged.isMasquerading, false)
  })

  test('keeps independent start and stop budgets and leaves rejected requests outside package audit', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idleStatus = await status(client, actor)
    const started = await startMode(client, actor, target.id, idleStatus.contextToken)
    started.assertStatus(200)
    const activeToken = started.body().contextToken as string

    const secondStart = await startMode(client, actor, target.id, activeToken)
    secondStart.assertStatus(409)
    const auditBeforeRateLimit = await eventCount(actor.id)

    const rejectedStart = await startMode(client, actor, target.id, activeToken)
    rejectedStart.assertStatus(429)
    rejectedStart.assertHeader('retry-after')
    assert.equal(await eventCount(actor.id), auditBeforeRateLimit)

    const stopped = await client
      .post('/masquerade/stop')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', activeToken)
      .json({})
      .loginAs(actor)
    stopped.assertStatus(200)
  })

  test('keeps idle unsafe requests under the raw actor Bouncer policy with a valid token', async ({
    client,
  }) => {
    const { actor } = await createUsers()
    const idleStatus = await status(client, actor)
    const actorAbility = await mutation(
      client,
      actor,
      idleStatus.contextToken,
      '/business/actor-only'
    )
    actorAbility.assertStatus(200)
    actorAbility.assertBodyContains({ effectiveId: actor.id })
    const targetOnlyAbility = await mutation(
      client,
      actor,
      idleStatus.contextToken,
      '/business/mutate'
    )
    targetOnlyAbility.assertStatus(403)
  })

  test('shares a hidden context field and preserves the admitted snapshot through a concurrent stop', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idleStatus = await status(client, actor)
    const idleToken = idleStatus.contextToken
    const started = await startMode(client, actor, target.id, idleToken)
    started.assertStatus(200)
    assert.equal(started.body().targetId, target.id)
    const activeToken = started.body().contextToken as string
    const preStartToken = await mutation(client, actor, idleToken)
    preStartToken.assertStatus(409)
    const form = await client.get('/business/form').loginAs(actor)
    form.assertStatus(200)
    assert.include(form.text(), `value="${activeToken}"`)

    const secondOperator = await createUsers()
    const foreignFormSubmit = await client
      .post('/business/mutate')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .form({ _masqueradeContext: activeToken })
      .loginAs(secondOperator.actor)
    foreignFormSubmit.assertStatus(409)

    const admitted = await client.get('/business/admitted-stop-form').loginAs(actor)
    admitted.assertStatus(200)
    assert.include(admitted.text(), `value="${activeToken}"`)
    const staleSubmit = await client
      .post('/business/mutate')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', activeToken)
      .json({})
      .loginAs(actor)
    staleSubmit.assertStatus(409)
    const after = await client.get('/business').loginAs(actor)
    after.assertBodyContains({ effectiveId: actor.id, actorAllowed: true })
  })

  test('enforces unsafe action markers, with sensitive taking precedence over allowMutation', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idleStatus = await status(client, actor)
    const idleToken = idleStatus.contextToken
    const active = await startMode(client, actor, target.id, idleToken)
    const token = active.body().contextToken as string
    const formControl = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .form({
        targetId: String(target.id),
        reason: 'repeat attempt',
        access: 'edit',
        _masqueradeContext: token,
      })
      .loginAs(actor)
    formControl.assertStatus(409)
    const rejected = await mutation(client, actor, token, '/business/denied-mutation')
    rejected.assertStatus(403)
    assert.equal(rejected.body().errors[0].code, 'E_MASQUERADE_ACTION_BLOCKED')
    const fakeRead = await mutation(client, actor, token, '/business/read-marked-mutation')
    fakeRead.assertStatus(403)
    const allowed = await mutation(client, actor, token, '/business/mutate')
    allowed.assertStatus(200)
    assert.equal(allowed.body().effectiveId, target.id)
    const inheritedMarker = await mutation(client, actor, token, '/business/group-marked')
    inheritedMarker.assertStatus(200)
    inheritedMarker.assertBodyContains({ effectiveId: target.id, rawActorId: actor.id })
    const actorOnly = await mutation(client, actor, token, '/business/actor-only')
    actorOnly.assertStatus(403)
    for (const path of ['/business/sensitive', '/business/billing']) {
      const blocked = await mutation(client, actor, token, path)
      blocked.assertStatus(403)
      assert.equal(blocked.body().errors[0].code, 'E_MASQUERADE_ACTION_BLOCKED')
    }
  })

  test('default start is view-only and blocks the preference change; edit start permits it; stop works in view mode', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await status(client, actor)
    const viewStart = await client
      .post('/masquerade/start')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', idle.contextToken)
      .json({ targetId: target.id, reason: 'default view-only mode' })
      .loginAs(actor)
    viewStart.assertStatus(200)
    assert.equal(viewStart.body().access, 'view')
    const viewToken = viewStart.body().contextToken as string

    const blocked = await client
      .post('/support/customer/preference')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .form({ emailUpdates: '1', _masqueradeContext: viewToken })
      .loginAs(actor)
    blocked.assertStatus(403)
    assert.equal(blocked.body().errors[0].code, 'E_MASQUERADE_ACTION_BLOCKED')
    assert.equal(blocked.body().errors[0].blockedBy, 'view_only')
    assert.isNull(await db.from('demo_preferences').where('user_id', target.id).first())
    const stopped = await client
      .post('/masquerade/stop')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', viewToken)
      .json({})
      .loginAs(actor)
    stopped.assertStatus(200)

    const editStart = await startMode(client, actor, target.id, stopped.body().contextToken, 'edit')
    editStart.assertStatus(200)
    assert.equal(editStart.body().access, 'edit')
    const edited = await client
      .post('/support/customer/preference')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'text/html')
      .form({ emailUpdates: '1', _masqueradeContext: editStart.body().contextToken })
      .loginAs(actor)
    edited.assertStatus(302)
    const saved = await db.from('demo_preferences').where('user_id', target.id).first()
    assert.equal(saved?.email_updates, 1)
  })

  test('fails closed before admission on mixed raw/effective guard routes in either order', async ({
    client,
    assert,
  }) => {
    const { actor } = await createUsers()
    const paths = ['/business/mixed-raw-first', '/business/mixed-effective-first']
    for (const path of paths) {
      resetMasqueradeReadCount()
      const loggedActor = await mutation(client, actor, undefined, path)
      loggedActor.assertStatus(503)
      assert.equal(loggedActor.body().errors[0].code, 'E_MASQUERADE_UNAVAILABLE')
      assert.notProperty(loggedActor.body(), 'ran')
      assert.equal(masqueradeFixtureDiagnostics().modeReads, 0)
    }

    resetMasqueradeReadCount()
    const unauthenticated = await client
      .post(paths[0])
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({})
    unauthenticated.assertStatus(503)
    assert.notProperty(unauthenticated.body(), 'ran')
    assert.equal(masqueradeFixtureDiagnostics().modeReads, 0)
  })

  test('keeps raw actor routes and login/logout available without store reads during outage', async ({
    client,
    assert,
  }) => {
    const { actor } = await createUsers()
    resetMasqueradeFixtureDiagnostics()
    const raw = await client.get('/raw-business').loginAs(actor)
    raw.assertStatus(200)
    assert.equal(masqueradeFixtureDiagnostics().modeReads, 0)

    setMasqueradeStoreUnavailable(true)
    const statusResponse = await client.get('/masquerade').loginAs(actor)
    statusResponse.assertStatus(503)
    assert.equal(statusResponse.body().errors[0].code, 'E_MASQUERADE_UNAVAILABLE')
    statusResponse.assertHeader('cache-control', 'no-store')
    const stopResponse = await client
      .post('/masquerade/stop')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({})
      .loginAs(actor)
    stopResponse.assertStatus(503)
    stopResponse.assertHeader('cache-control', 'no-store')
    const login = await client.get('/login')
    login.assertStatus(200)
    const dashboard = await client.get('/dashboard').loginAs(actor)
    dashboard.assertStatus(503)
    const loginPost = await client
      .post('/login')
      .redirects(0)
      .withCsrfToken()
      .form({ email: actor.email, password: 'secret' })
    loginPost.assertStatus(302)
    resetMasqueradeReadCount()
    const logout = await client.post('/logout').redirects(0).withCsrfToken().loginAs(actor)
    logout.assertStatus(302)
    assert.equal(masqueradeFixtureDiagnostics().modeReads, 0)
  })

  test('logout ends only the actor session that submitted it', async ({ assert }) => {
    const { actor, target } = await createUsers()
    let loginAttempts = 0
    const onLoginAttempted = () => loginAttempts++
    emitter.on('session_auth:login_attempted', onLoginAttempted)
    try {
      const actorSessionOne = await loginOverHttp(actor.email)
      const actorSessionTwo = await loginOverHttp(actor.email)
      const targetSession = await loginOverHttp(target.email)
      assert.equal(loginAttempts, 3)
      assert.notEqual(actorSessionOne.cookie, actorSessionTwo.cookie)

      const idle = await getRealStatus(actorSessionOne)
      const startedResponse = await fetch(fixtureUrl('/masquerade/start'), {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          'cookie': actorSessionOne.cookie,
          'x-csrf-token': actorSessionOne.csrfToken,
        },
        body: new URLSearchParams({
          targetId: String(target.id),
          reason: 'credential isolation',
          _masqueradeContext: idle.contextToken,
        }),
      })
      assert.equal(startedResponse.status, 200)
      assert.equal(loginAttempts, 3)

      const secondActorSession = await fetchBusiness(actorSessionTwo)
      assert.deepEqual(
        { actorId: secondActorSession.actorId, effectiveId: secondActorSession.effectiveId },
        { actorId: actor.id, effectiveId: target.id }
      )
      const logout = await fetch(fixtureUrl('/logout'), {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'cookie': actorSessionOne.cookie,
          'x-csrf-token': actorSessionOne.csrfToken,
        },
      })
      assert.equal(logout.status, 302)
      assert.equal(logout.headers.get('location'), '/login')

      const endedSession = await fetch(fixtureUrl('/business'), {
        redirect: 'manual',
        headers: { cookie: actorSessionOne.cookie, accept: 'text/html' },
      })
      assert.equal(endedSession.status, 302)
      assert.equal(endedSession.headers.get('location'), '/login')
      const survivingActorSession = await fetchBusiness(actorSessionTwo)
      assert.deepEqual(
        { actorId: survivingActorSession.actorId, effectiveId: survivingActorSession.effectiveId },
        { actorId: actor.id, effectiveId: target.id }
      )
      const targetStillOwnSession = await fetchBusiness(targetSession)
      assert.deepEqual(
        { actorId: targetStillOwnSession.actorId, effectiveId: targetStillOwnSession.effectiveId },
        { actorId: target.id, effectiveId: target.id }
      )
      const mode = await getRealStatus(actorSessionTwo)
      assert.isTrue(mode.isMasquerading)
      assert.equal(loginAttempts, 3)

      actor.securityStamp = 'actor-v2'
      await actor.save()
      const invalidated = await fetchBusinessResponse(actorSessionTwo)
      assert.equal(invalidated.status, 409)
      const afterStampChange = await fetchBusiness(actorSessionTwo)
      assert.equal(afterStampChange.effectiveId, actor.id)
    } finally {
      emitter.off('session_auth:login_attempted', onLoginAttempted)
    }
  })

  test('does not mint target credentials and never unions actor Bouncer access', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/business').loginAs(actor)
    const idleStatus = await status(client, actor)
    const idleToken = idleStatus.contextToken
    const started = await startMode(client, actor, target.id, idleToken)
    started.assertStatus(200)
    const active = await client.get('/business').loginAs(actor)
    active.assertBodyContains({ actorId: actor.id, effectiveId: target.id, actorAllowed: false })
    assert.notEqual(active.body().rawActorId, target.id)
    const targetRoute = await client.get('/business').loginAs(target)
    targetRoute.assertBodyContains({ actorId: target.id, effectiveId: target.id })
    assert.equal(idle.body().rawActorId, actor.id)
    const finalStatus = await status(client, actor)
    assert.equal(finalStatus.isMasquerading, true)
  })
})

async function status(client: ApiClient, actor: User) {
  const response = await client.get('/masquerade').loginAs(actor)
  response.assertStatus(200)
  response.assertHeader('cache-control', 'no-store')
  return response.body() as { contextToken: string; isMasquerading?: boolean }
}

type RealSession = { cookie: string; csrfToken: string }

async function loginOverHttp(email: string): Promise<RealSession> {
  const loginPage = await fetch(fixtureUrl('/login'))
  const loginHtml = await loginPage.text()
  const csrfToken = loginHtml.match(/name=["']_csrf["'] value=["']([^"']+)["']/)?.[1]
  const initialCookie = sessionCookie(loginPage)
  if (!csrfToken || !initialCookie) throw new Error('login page omitted CSRF or session data')

  const response = await fetch(fixtureUrl('/login'), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'accept': 'text/html',
      'content-type': 'application/x-www-form-urlencoded',
      'cookie': initialCookie,
      'x-csrf-token': csrfToken,
    },
    body: new URLSearchParams({ email, password: 'secret' }),
  })
  if (response.status !== 302) throw new Error(`native login returned ${response.status}`)
  return { cookie: sessionCookie(response) ?? initialCookie, csrfToken }
}

function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .find((value) => value.startsWith('adonis-session='))
}

function fixtureUrl(path: string): URL {
  const host = process.env.HOST ?? '127.0.0.1'
  const port = process.env.PORT ?? '3333'
  return new URL(path, `http://${host}:${port}`)
}

async function getRealStatus(session: RealSession) {
  const response = await fetch(fixtureUrl('/masquerade'), {
    headers: { accept: 'application/json', cookie: session.cookie },
  })
  if (response.status !== 200) throw new Error(`status request returned ${response.status}`)
  return (await response.json()) as { contextToken: string; isMasquerading: boolean }
}

async function fetchBusiness(session: RealSession) {
  const response = await fetchBusinessResponse(session)
  if (response.status !== 200) throw new Error(`business request returned ${response.status}`)
  return (await response.json()) as { actorId: number; effectiveId: number }
}

function fetchBusinessResponse(session: RealSession) {
  return fetch(fixtureUrl('/business'), {
    headers: { accept: 'application/json', cookie: session.cookie },
    redirect: 'manual',
  })
}

function startMode(
  client: ApiClient,
  actor: User,
  targetId: number,
  token: string,
  access: 'view' | 'edit' = 'edit'
) {
  return client
    .post('/masquerade/start')
    .withCsrfToken()
    .header('Accept', 'application/json')
    .header('X-Masquerade-Context', token)
    .json({ targetId, reason: 'support case 1042', access })
    .loginAs(actor)
}

function mutation(client: ApiClient, actor: User, token?: string, path = '/business/mutate') {
  const request = client.post(path).withCsrfToken().header('Accept', 'application/json').json({})
  if (token) request.header('X-Masquerade-Context', token)
  return request.loginAs(actor)
}

function idleTokenFor(namespace: string, actorId: number): string {
  const parts = [namespace, String(actorId), String(actorId)]
    .map((part) => `${Buffer.byteLength(part)}:${part}`)
    .join('')
  return `0.${createHash('sha256').update(parts).digest('hex')}`
}

async function eventCount(actorId: number) {
  const result = await db
    .from('masquerade_events')
    .where('actor_id', String(actorId))
    .count('* as total')
    .first()
  return Number(result?.total)
}
