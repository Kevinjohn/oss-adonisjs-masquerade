import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import { approveUsers } from '#tests/helpers/account_kit_admission'
import { AccountKitHttp } from '#tests/helpers/account_kit_http'
import User from '#models/user'

const tokenStrategy = process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens'
const controlPath = tokenStrategy ? '/api/masquerade' : '/masquerade'
const businessPath = tokenStrategy ? '/api/business' : '/business'
const password = 'AccountKitPass123!'

async function body(response: Response) {
  return (await response.json()) as Record<string, any>
}

test.group('packed Account Kit and Masquerade HTTP journey', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.teardown(() => cleanUsers())

  test('Kit credential starts a mode, managed account actions block, and stop restores access', async ({
    assert,
  }) => {
    const { actor, target } = await createUsers()
    actor.password = password
    actor.emailVerifiedAt = DateTime.now()
    target.emailVerifiedAt = DateTime.now()
    await actor.save()
    await target.save()
    await approveUsers(actor, target)

    const http = new AccountKitHttp()
    let csrf = tokenStrategy ? undefined : await http.csrf()
    const login = await http.json(
      '/kit/auth/login',
      'POST',
      { email: actor.email, password },
      csrf ? { 'x-csrf-token': csrf } : {}
    )
    assert.equal(login.status, 200)
    const loginBody = await body(login)
    const token = tokenStrategy ? String(loginBody.token) : undefined
    if (tokenStrategy) assert.isTrue(token && token !== 'undefined')
    const authHeaders = token ? { authorization: `Bearer ${token}` } : {}
    if (!tokenStrategy) csrf = await http.csrf()

    const status = await http.request(controlPath, {
      headers: { accept: 'application/json', ...authHeaders },
    })
    assert.equal(status.status, 200)
    const initial = await body(status)
    assert.isFalse(initial.isMasquerading)
    const statusSamples: number[] = []
    for (let index = 0; index < 5; index++) {
      const began = performance.now()
      const sample = await http.request(controlPath, {
        headers: { accept: 'application/json', ...authHeaders },
      })
      assert.equal(sample.status, 200)
      statusSamples.push(Math.round((performance.now() - began) * 100) / 100)
    }
    console.log(
      `ACCOUNT_KIT_TIMING ${JSON.stringify({ strategy: tokenStrategy ? 'access_tokens' : 'session', database: process.env.DB_CLIENT, operation: 'authenticated_idle_status_http', samplesMs: statusSamples })}`
    )

    const idleBusinessSamples: number[] = []
    for (let index = 0; index < 5; index++) {
      const began = performance.now()
      const response = await http.request(businessPath, {
        headers: {
          'accept': 'application/json',
          ...authHeaders,
          'X-Masquerade-Context': initial.contextToken,
        },
      })
      assert.equal(response.status, 200)
      const data = await body(response)
      assert.equal(data.effectiveId, actor.id)
      idleBusinessSamples.push(Math.round((performance.now() - began) * 100) / 100)
    }
    console.log(
      `ACCOUNT_KIT_TIMING ${JSON.stringify({ strategy: tokenStrategy ? 'access_tokens' : 'session', database: process.env.DB_CLIENT, operation: 'idle_business_http', samplesMs: idleBusinessSamples })}`
    )

    const started = await http.json(
      `${controlPath}/start`,
      'POST',
      { targetId: target.id, reason: 'Account Kit consumer journey', access: 'edit' },
      {
        ...authHeaders,
        'X-Masquerade-Context': initial.contextToken,
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      }
    )
    assert.equal(started.status, 200)
    const active = await body(started)
    assert.isTrue(active.isMasquerading)
    assert.equal(active.targetId, target.id)

    const activeSamples: number[] = []
    for (let index = 0; index < 5; index++) {
      const began = performance.now()
      const response = await http.request(businessPath, {
        headers: {
          'accept': 'application/json',
          ...authHeaders,
          'X-Masquerade-Context': active.contextToken,
        },
      })
      assert.equal(response.status, 200)
      const data = await body(response)
      assert.equal(data.actorId, actor.id)
      assert.equal(data.effectiveId, target.id)
      if (tokenStrategy) assert.equal(data.bouncerUserId, target.id)
      activeSamples.push(Math.round((performance.now() - began) * 100) / 100)
    }
    console.log(
      `ACCOUNT_KIT_TIMING ${JSON.stringify({ strategy: tokenStrategy ? 'access_tokens' : 'session', database: process.env.DB_CLIENT, operation: 'active_business_http', samplesMs: activeSamples })}`
    )
    const blocked = await http.json(
      '/kit/account/password',
      'POST',
      { currentPassword: password, newPassword: 'OtherPass123!' },
      { ...authHeaders, ...(csrf ? { 'x-csrf-token': csrf } : {}) }
    )
    assert.equal(blocked.status, 403)
    const blockedBody = await body(blocked)
    assert.equal(blockedBody.errors[0].code, 'E_MASQUERADE_ACTION_BLOCKED')
    assert.equal(blockedBody.errors[0].blockedBy, 'sensitive')

    if (tokenStrategy) {
      const noAbility = await User.accessTokens.create(actor, ['profile:read'])
      const noAbilityResponse = await http.json(
        '/kit/account/password',
        'POST',
        { currentPassword: password, newPassword: 'OtherPass123!' },
        { authorization: `Bearer ${noAbility.value!.release()}` }
      )
      assert.equal(noAbilityResponse.status, 403)
      assert.equal((await body(noAbilityResponse)).errors[0].code, 'E_MASQUERADE_ACTION_BLOCKED')
    } else {
      const allowedCsrf = await http.csrf()
      assert.isString(allowedCsrf)
    }

    const stopped = await http.json(
      `${controlPath}/stop`,
      'POST',
      {},
      {
        ...authHeaders,
        'X-Masquerade-Context': active.contextToken,
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      }
    )
    assert.equal(stopped.status, 200)
    const restored = await http.request('/kit/account/profile', {
      headers: { accept: 'application/json', ...authHeaders },
    })
    assert.equal(restored.status, 200)
  })
})
