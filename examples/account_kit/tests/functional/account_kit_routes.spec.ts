import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import router from '@adonisjs/core/services/router'
import db from '@adonisjs/lucid/services/db'
import { managedRouteRegistration } from '@kevinjohn/adonisjs-account-kit/http'
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'
import User from '#models/user'
import { approveUsers } from '#tests/helpers/account_kit_admission'
import { AccountKitHttp } from '#tests/helpers/account_kit_http'
import {
  accountKitPassword,
  cleanAccountKitUsers,
  createAccountKitUsers,
} from '#tests/helpers/account_kit_credentials'

const strategy =
  process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens' ? 'access_tokens' : 'session'
const control = strategy === 'session' ? '/masquerade' : '/api/masquerade'

async function json(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>
}

async function actorSession(actor: User) {
  const http = new AccountKitHttp()
  const login = await http.login(actor.email, accountKitPassword, strategy)
  return { http, csrf: login.csrf, authorization: login.token ? `Bearer ${login.token}` : '' }
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

async function startMode(session: Awaited<ReturnType<typeof actorSession>>, target: User) {
  const status = await session.http.request(control, { headers: headers(session) })
  if (status.status !== 200) throw new Error(`status returned ${status.status}`)
  const idle = await json(status)
  const started = await session.http.json(
    `${control}/start`,
    'POST',
    {
      targetId: target.id,
      reason: 'managed route coverage',
      access: 'edit',
    },
    headers(session, { 'X-Masquerade-Context': idle.contextToken })
  )
  if (started.status !== 200)
    throw new Error(`start returned ${started.status}: ${await started.text()}`)
  return json(started)
}

async function requestManaged(
  session: Awaited<ReturnType<typeof actorSession>>,
  path: string,
  method: string
) {
  return session.http.request(path, {
    method,
    headers: { ...headers(session), 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  })
}

async function controlState(actorId: number) {
  return {
    mode: await db.from('masquerade_modes').where('actor_id', String(actorId)).first(),
    events: await db.from('masquerade_events').where('actor_id', String(actorId)).orderBy('id'),
  }
}

test.group('packed Account Kit managed route blocker', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanAccountKitUsers())

  test('blocks every mounted non-exempt managed route before its handler', async ({ assert }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const session = await actorSession(actor)
    await startMode(session, target)
    const before = await controlState(actor.id)
    const registration = managedRouteRegistration(router)
    assert.exists(registration)
    assert.isTrue(registration!.routes.length > 0)
    for (const route of registration!.routes) {
      if (route.name === 'account.logout' || route.name === 'auth.csrf') continue
      const path = route.path.replace(/:[^/]+/g, 'not-a-proof')
      const response = await requestManaged(session, path, route.method)
      assert.equal(response.status, 403, `${route.name} ${route.method} ${path}`)
      const result = await json(response)
      assert.equal(result.errors?.[0]?.code, 'E_MASQUERADE_ACTION_BLOCKED', route.name)
      assert.equal(result.errors?.[0]?.blockedBy, 'sensitive', route.name)
      assert.deepEqual(await controlState(actor.id), before, route.name)
    }
    const excluded = await requestManaged(session, '/kit/auth/methods', 'GET')
    assert.equal(excluded.status, 404)
  })

  test('blocks a token lacking masquerade ability while an actor mode is active', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const session = await actorSession(actor)
    await startMode(session, target)
    const before = await controlState(actor.id)
    const credential = await User.accessTokens.create(actor, ['profile:read'])
    const noAbility = `Bearer ${credential.value!.release()}`
    const response = await session.http.request('/kit/account/profile', {
      headers: { accept: 'application/json', authorization: noAbility },
    })
    assert.equal(response.status, 403)
    assert.equal((await json(response)).errors?.[0]?.blockedBy, 'sensitive')
    assert.deepEqual(await controlState(actor.id), before)
  }).skip(strategy !== 'access_tokens', 'requires the access_tokens strategy')

  test('preserves managed profile behavior for no row, idle row, and another actor', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const session = await actorSession(actor)
    const original = LucidControlStore.prototype.read
    const owners: Array<{ namespace: string; actorId: string; actorIncarnation: string }> = []
    LucidControlStore.prototype.read = async function (owner) {
      owners.push({ ...owner })
      return original.call(this, owner)
    }
    const expected = (id: number) => ({
      namespace: 'packed-account-kit-consumer',
      actorId: String(id),
      actorIncarnation: String(id),
    })
    try {
      const noRow = await requestManaged(session, '/kit/account/profile', 'GET')
      assert.equal(noRow.status, 200)
      assert.deepEqual(owners, [expected(actor.id)])
      const active = await startMode(session, target)
      const other = await actorSession(target)
      owners.length = 0
      assert.equal((await requestManaged(other, '/kit/account/profile', 'GET')).status, 200)
      assert.deepEqual(owners, [expected(target.id)])
      const stopped = await session.http.json(
        `${control}/stop`,
        'POST',
        {},
        headers(session, { 'X-Masquerade-Context': active.contextToken })
      )
      assert.equal(stopped.status, 200)
      owners.length = 0
      const idle = await requestManaged(session, '/kit/account/profile', 'GET')
      assert.equal(idle.status, 200)
      assert.deepEqual(owners, [expected(actor.id)])
    } finally {
      LucidControlStore.prototype.read = original
    }
  })

  test('keeps unauthenticated proof, CSRF, and logout store-free during an outage', async ({
    assert,
  }) => {
    const { actor, target } = await createAccountKitUsers()
    await approveUsers(actor, target)
    const session = await actorSession(actor)
    await startMode(session, target)
    assert.include(
      managedRouteRegistration(router)?.routes.map((route) => route.name),
      'auth.passwordReset.request'
    )
    const before = await db.from('masquerade_modes').where('actor_id', String(actor.id)).first()
    const original = LucidControlStore.prototype.read
    let reads = 0
    LucidControlStore.prototype.read = async function () {
      reads++
      throw new Error('store down')
    }
    try {
      const anonymous = new AccountKitHttp()
      const anonymousCsrf = strategy === 'session' ? await anonymous.csrf() : undefined
      const proof = await anonymous.json(
        '/kit/auth/password-reset',
        'POST',
        { email: actor.email },
        anonymousCsrf ? { 'x-csrf-token': anonymousCsrf } : {}
      )
      assert.equal(proof.status, 202)
      assert.equal((await json(proof)).message, 'If the account exists, instructions will be sent.')
      assert.equal(reads, 0)
      const denied = await requestManaged(session, '/kit/account/profile', 'GET')
      assert.equal(denied.status, 503)
      assert.equal((await json(denied)).errors?.[0]?.code, 'E_MASQUERADE_UNAVAILABLE')
      const afterDeniedReads = reads
      if (strategy === 'session') assert.isString(await session.http.csrf())
      assert.equal(reads, afterDeniedReads)
      const logout = await session.http.json('/kit/account/logout', 'POST', {}, headers(session))
      assert.isTrue(logout.status >= 200 && logout.status < 300)
      assert.equal(reads, afterDeniedReads)
    } finally {
      LucidControlStore.prototype.read = original
    }
    assert.deepEqual(
      await db.from('masquerade_modes').where('actor_id', String(actor.id)).first(),
      before
    )
  })
})
