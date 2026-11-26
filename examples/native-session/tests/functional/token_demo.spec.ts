import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { cleanUsers, createAccessToken, createUsers } from '#tests/helpers/users'

test.group('ordinary bearer support demo', (group) => {
  function bearer(value: string) {
    return `Bearer ${value}`
  }

  function tokenStatus(client: ApiClient, token: string) {
    return client.get('/api/masquerade').header('Authorization', bearer(token))
  }

  function tokenStart(client: ApiClient, token: string, targetId: number, contextToken: string) {
    return client
      .post('/api/masquerade/start')
      .header('Authorization', bearer(token))
      .header('X-Masquerade-Context', contextToken)
      .json({ targetId, reason: 'Documented native bearer demo', access: 'edit' })
  }

  function tokenStop(client: ApiClient, token: string, contextToken: string) {
    return client
      .post('/api/masquerade/stop')
      .header('Authorization', bearer(token))
      .header('X-Masquerade-Context', contextToken)
      .json({})
  }

  group.setup(() => testUtils.db().migrate())
  group.each.teardown(async () => {
    await limiter.clear(['memory'])
    await cleanUsers()
  })

  test('shares one native token lifecycle with the browser account mode', async ({
    client,
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const { actor: incidentalCookieActor } = await createUsers()
    const { value } = await createAccessToken(actor)
    target.email = 'customer@example.test'
    await target.save()

    const cookieOnlyStatus = await client.get('/api/masquerade').loginAs(actor)
    cookieOnlyStatus.assertStatus(401)
    const idle = await tokenStatus(client, value)
    idle.assertStatus(200)
    const idleContext = idle.body().contextToken as string

    const idleCustomer = await client
      .get('/api/support/customer')
      .header('Authorization', bearer(value))
    idleCustomer.assertStatus(409)
    assert.equal(idleCustomer.body().errors[0].code, 'E_MASQUERADE_CONTEXT_CHANGED')

    const started = await tokenStart(client, value, target.id, idleContext)
    started.assertStatus(200)
    const activeContext = started.body().contextToken as string

    const customer = await client
      .get('/api/support/customer')
      .header('Authorization', bearer(value))
      .loginAs(incidentalCookieActor)
    customer.assertStatus(200)
    customer.assertBodyContains({
      actor: { id: String(actor.id) },
      customer: {
        id: String(target.id),
        fullName: target.fullName,
        email: target.email,
        emailUpdates: false,
      },
      mode: { isMasquerading: true, contextToken: activeContext, targetId: String(target.id) },
    })

    const browserStatus = await client.get('/masquerade').loginAs(actor)
    browserStatus.assertBodyContains({ isMasquerading: true, targetId: String(target.id) })
    const browserStop = await client
      .post('/masquerade/stop')
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', activeContext)
      .json({})
      .loginAs(actor)
    browserStop.assertStatus(200)
    const tokenIdleAgain = await tokenStatus(client, value)
    tokenIdleAgain.assertBodyContains({ isMasquerading: false })
  })

  test('keeps token start and stop budgets independent and keyed to the bearer actor', async ({
    client,
  }) => {
    const { actor, target } = await createUsers()
    const second = await createUsers()
    const { value } = await createAccessToken(actor)
    const secondToken = await createAccessToken(second.actor)
    const cookieOnlyStart = await client
      .post('/api/masquerade/start')
      .json({ targetId: target.id, reason: 'Cookie credentials are not bearer credentials' })
      .loginAs(actor)
    cookieOnlyStart.assertStatus(401)

    const idle = await tokenStatus(client, value)
    const contextToken = idle.body().contextToken as string

    const firstStart = await tokenStart(client, value, target.id, contextToken)
    firstStart.assertStatus(200)
    const activeContext = firstStart.body().contextToken as string

    const staleStart = await tokenStart(client, value, target.id, contextToken)
    staleStart.assertStatus(409)
    const exhaustedStart = await tokenStart(client, value, target.id, contextToken)
    exhaustedStart.assertStatus(429)

    const secondIdle = await tokenStatus(client, secondToken.value)
    const secondStart = await tokenStart(
      client,
      secondToken.value,
      second.target.id,
      secondIdle.body().contextToken
    )
    secondStart.assertStatus(200)

    const stopped = await tokenStop(client, value, activeContext)
    stopped.assertStatus(200)
  })

  test('uses the bearer credential on exempt logout without ending browser mode', async ({
    client,
  }) => {
    const { actor, target } = await createUsers()
    const { value } = await createAccessToken(actor)
    const idle = await tokenStatus(client, value)
    const started = await tokenStart(client, value, target.id, idle.body().contextToken)
    started.assertStatus(200)

    const cookieOnlyLogout = await client.post('/api/logout').loginAs(actor).json({})
    cookieOnlyLogout.assertStatus(401)

    const logout = await client.post('/api/logout').header('Authorization', bearer(value)).json({})
    logout.assertStatus(200)
    logout.assertBodyContains({ loggedOut: true })
    const tokenRevoked = await tokenStatus(client, value)
    tokenRevoked.assertStatus(401)

    const browserStillActive = await client.get('/masquerade').loginAs(actor)
    browserStillActive.assertBodyContains({ isMasquerading: true, targetId: String(target.id) })
  })

  test('keeps browser session control behind Shield CSRF validation', async ({ client }) => {
    const { actor, target } = await createUsers()
    const idle = await client.get('/masquerade').loginAs(actor)
    const contextToken = idle.body().contextToken as string

    const withoutCsrf = await client
      .post('/masquerade/start')
      .redirects(0)
      .header('X-Masquerade-Context', contextToken)
      .form({ targetId: String(target.id), reason: 'Browser CSRF boundary' })
      .loginAs(actor)
    withoutCsrf.assertStatus(302)
    withoutCsrf.assertHeader('location', '/')

    const stillIdle = await client.get('/masquerade').loginAs(actor)
    stillIdle.assertBodyContains({ isMasquerading: false })

    const withCsrf = await client
      .post('/masquerade/start')
      .redirects(0)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .header('X-Masquerade-Context', contextToken)
      .json({ targetId: target.id, reason: 'Browser CSRF boundary' })
      .loginAs(actor)
    withCsrf.assertStatus(200)
  })
})
