import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import type User from '#models/user'
import {
  masqueradeFixtureDiagnostics,
  resetMasqueradeReadCount,
} from '#services/masquerade_fixture_boundary'

test.group('effective session guard through the packed package', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanUsers())

  test('renders the authenticated dashboard with a working native logout form', async ({
    client,
    assert,
  }) => {
    const { actor } = await createUsers()
    const dashboard = await client.get('/dashboard').loginAs(actor)
    dashboard.assertStatus(200)
    assert.match(dashboard.text(), /<form[^>]*action="\/logout"[^>]*>/)
    assert.include(dashboard.text(), 'Log out')

    const logout = await client.post('/logout').withCsrfToken().loginAs(actor).redirects(0)
    logout.assertStatus(302)
    logout.assertHeader('location', '/login')
  })

  test('facade, raw actor, Bouncer and silent_auth retain their identities across start and stop', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/business').loginAs(actor)
    idle.assertStatus(200)
    idle.assertBodyContains({
      actorId: actor.id,
      effectiveId: actor.id,
      getUserOrFailId: actor.id,
      authenticatedViaGuard: 'web_effective',
      rawActorId: actor.id,
      bouncerUserId: actor.id,
      actorAllowed: true,
      silentAuthSnapshot: { guard: 'web_effective', userId: actor.id },
    })
    const idleStatus = await getStatus(client, actor)
    const idleToken = idleStatus.contextToken

    const started = await startMode(client, actor, target.id, idleToken)
    started.assertStatus(200)
    started.assertHeader('cache-control', 'no-store')
    const activeMode = started.body()
    assert.isTrue(activeMode.isMasquerading)
    const active = await client.get('/business').loginAs(actor)
    active.assertBodyContains({
      actorId: actor.id,
      effectiveId: target.id,
      getUserOrFailId: target.id,
      authenticatedViaGuard: 'web_effective',
      rawActorId: actor.id,
      bouncerUserId: target.id,
      actorAllowed: false,
      silentAuthSnapshot: { guard: 'web_effective', userId: target.id },
    })

    const stopped = await stopMode(client, actor, activeMode.contextToken)
    stopped.assertStatus(200)
    const after = await client.get('/business').loginAs(actor)
    after.assertBodyContains({
      actorId: actor.id,
      effectiveId: actor.id,
      getUserOrFailId: actor.id,
      authenticatedViaGuard: 'web_effective',
      rawActorId: actor.id,
      bouncerUserId: actor.id,
      actorAllowed: true,
      silentAuthSnapshot: { guard: 'web_effective', userId: actor.id },
    })
  })

  test('driverName keeps native unauthenticated HTML and JSON behavior', async ({
    client,
    assert,
  }) => {
    resetMasqueradeReadCount()
    const html = await client.get('/business').redirects(0).header('Accept', 'text/html')
    html.assertStatus(302)
    html.assertHeader('location', '/login')
    const api = await client.get('/business').header('Accept', 'application/json')
    api.assertStatus(401)
    api.assertHeader('content-type', 'application/json; charset=utf-8')
    assert.equal(api.body().errors[0].message, 'Unauthorized access')
    assert.equal(masqueradeFixtureDiagnostics().modeReads, 0)
  })

  test('Japa loginAs authenticates target routes through the configured effective default', async ({
    client,
  }) => {
    const { actor } = await createUsers()
    const response = await client.get('/business').loginAs(actor)
    response.assertStatus(200)
    response.assertBodyContains({ effectiveId: actor.id, authenticatedViaGuard: 'web_effective' })
  })

  test('two active operators see separate persisted targets', async ({ client, assert }) => {
    const first = await createUsers()
    const second = await createUsers()
    const firstIdle = await getStatus(client, first.actor)
    const secondIdle = await getStatus(client, second.actor)
    await startMode(client, first.actor, first.target.id, firstIdle.contextToken)
    await startMode(client, second.actor, second.target.id, secondIdle.contextToken)
    const firstResponse = await client.get('/business').loginAs(first.actor)
    const secondResponse = await client.get('/business').loginAs(second.actor)
    assert.equal(firstResponse.body().effectiveId, first.target.id)
    assert.equal(secondResponse.body().effectiveId, second.target.id)
    assert.notEqual(firstResponse.body().effectiveId, secondResponse.body().effectiveId)
  })
})

async function getStatus(client: ApiClient, actor: User) {
  const response = await client.get('/masquerade').loginAs(actor)
  response.assertStatus(200)
  response.assertHeader('cache-control', 'no-store')
  return response.body()
}

function startMode(client: ApiClient, actor: User, targetId: number, contextToken: string) {
  return client
    .post('/masquerade/start')
    .withCsrfToken()
    .header('Accept', 'application/json')
    .header('X-Masquerade-Context', contextToken)
    .json({ targetId, reason: 'support case 1042', access: 'edit' })
    .loginAs(actor)
}

function stopMode(client: ApiClient, actor: User, contextToken: string) {
  return client
    .post('/masquerade/stop')
    .withCsrfToken()
    .header('Accept', 'application/json')
    .header('X-Masquerade-Context', contextToken)
    .json({})
    .loginAs(actor)
}
