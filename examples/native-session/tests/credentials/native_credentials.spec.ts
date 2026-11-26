import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'
import { cleanUsers, createUsers } from '#tests/helpers/users'
import { NativeCookieJar } from '#tests/helpers/native_cookie_jar'

type MasqueradeStatus = {
  contextToken: string
  isMasquerading: boolean
}

test.group('native session credential controls', (group) => {
  async function login(jar: NativeCookieJar, email: string, remember: boolean) {
    const page = await jar.request('/login', { headers: { accept: 'text/html' } })
    if (page.status !== 200) throw new Error(`login form returned ${page.status}`)
    const html = await page.text()
    const csrfToken = html.match(/name=["']_csrf["'] value=["']([^"']+)["']/)?.[1]
    if (!csrfToken) throw new Error('login form omitted its CSRF token')

    const response = await jar.request('/login', {
      method: 'POST',
      headers: formHeaders(csrfToken),
      body: new URLSearchParams({
        email,
        password: 'secret',
        ...(remember ? { remember: 'on' } : {}),
      }),
    })
    if (response.status !== 302) throw new Error(`native login returned ${response.status}`)
    return { status: response.status, csrfToken }
  }

  function formHeaders(csrfToken: string) {
    return {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrf-token': csrfToken,
    }
  }

  async function getFreshCsrfToken(jar: NativeCookieJar, path = '/login') {
    const response = await jar.request(path, { headers: { accept: 'text/html' } })
    if (response.status !== 200) throw new Error(`CSRF form returned ${response.status}`)
    const html = await response.text()
    const token = html.match(/name=["']_csrf["'] value=["']([^"']+)["']/)?.[1]
    if (!token) throw new Error('form omitted its CSRF token')
    return token
  }

  async function postControl(
    jar: NativeCookieJar,
    path: string,
    csrf: string,
    fields: Record<string, string>
  ) {
    return jar.request(path, {
      method: 'POST',
      headers: formHeaders(csrf),
      body: new URLSearchParams({ ...fields, _csrf: csrf }),
    })
  }

  async function modeRow(actorId: number) {
    return db.from('masquerade_modes').where('actor_id', String(actorId)).first()
  }

  async function eventCount(actorId: number) {
    const result = await db
      .from('masquerade_events')
      .where('actor_id', String(actorId))
      .count('* as total')
      .first()
    return Number(result?.total)
  }

  group.setup(() => testUtils.db().migrate())
  group.each.teardown(async () => {
    await limiter.clear(['memory'])
    await cleanUsers()
  })

  test('recovers the raw actor through remember-me after native session expiry while the effective guard keeps the admitted target', async ({
    assert,
  }) => {
    const { actor, target } = await createUsers()
    const activeJar = new NativeCookieJar()
    const controlJar = new NativeCookieJar()

    const activeLogin = await login(activeJar, actor.email, true)
    const idleStatusResponse = await activeJar.request('/masquerade', {
      headers: { accept: 'application/json' },
    })
    assert.equal(idleStatusResponse.status, 200)
    const idleStatus = (await idleStatusResponse.json()) as MasqueradeStatus
    const actorSessionId = activeJar.cookieValue('adonis-session')
    const actorRememberCookie = activeJar.cookieValue('remember_web')
    assert.isDefined(actorSessionId)
    assert.isDefined(actorRememberCookie)

    const start = await activeJar.request('/masquerade/start', {
      method: 'POST',
      headers: formHeaders(activeLogin.csrfToken),
      body: new URLSearchParams({
        targetId: String(target.id),
        reason: 'credential recovery control',
        _masqueradeContext: idleStatus.contextToken,
      }),
    })
    assert.equal(start.status, 200)
    assert.equal(activeJar.cookieValue('adonis-session'), actorSessionId)
    assert.equal(activeJar.cookieValue('remember_web'), actorRememberCookie)
    const active = (await start.json()) as { contextToken: string; targetId: number }
    assert.equal(active.targetId, target.id)
    const activeModeBeforeExpiry = await modeRow(actor.id)
    const eventCountBeforeExpiry = await eventCount(actor.id)

    const rawBeforeExpiry = await activeJar.request('/raw-business', {
      headers: { accept: 'application/json' },
    })
    assert.equal(rawBeforeExpiry.status, 200)
    assert.equal(((await rawBeforeExpiry.json()) as { actorId: number }).actorId, actor.id)
    const effectiveBeforeExpiry = await activeJar.request('/business', {
      headers: { accept: 'application/json' },
    })
    assert.equal(effectiveBeforeExpiry.status, 200)
    const activeIdentity = (await effectiveBeforeExpiry.json()) as {
      actorId: number
      effectiveId: number
    }
    assert.equal(activeIdentity.actorId, actor.id)
    assert.equal(activeIdentity.effectiveId, target.id)

    const controlLogin = await login(controlJar, actor.email, true)
    assert.equal(controlLogin.status, 302)

    const expiredJar = new NativeCookieJar()
    const expiredLogin = await login(expiredJar, actor.email, false)
    assert.equal(expiredLogin.status, 302)
    assert.equal(activeJar.has('remember_web'), true)
    assert.equal(controlJar.has('remember_web'), true)
    assert.equal(expiredJar.has('remember_web'), false)
    assert.equal(activeJar.has('adonis-session'), true)
    assert.equal(controlJar.has('adonis-session'), true)
    assert.equal(expiredJar.has('adonis-session'), true)

    await new Promise((resolve) => setTimeout(resolve, 1_150))

    // Both requests begin with the real one-second native cookie expired. The
    // remember-me cookie remains and the framework performs its normal recovery.
    assert.equal(activeJar.has('adonis-session'), false)
    assert.equal(controlJar.has('adonis-session'), false)
    assert.equal(expiredJar.has('adonis-session'), false)
    assert.equal(activeJar.has('remember_web'), true)
    assert.equal(controlJar.has('remember_web'), true)

    const expiredCsrf = await getFreshCsrfToken(expiredJar)
    const expiredStatus = await expiredJar.request('/masquerade', {
      headers: { accept: 'application/json' },
    })
    assert.equal(expiredStatus.status, 401)
    const expiredControl = await expiredJar.request('/raw-business', {
      headers: { accept: 'application/json' },
    })
    assert.equal(expiredControl.status, 401)
    const expiredBusiness = await expiredJar.request('/business', {
      headers: { accept: 'application/json' },
    })
    assert.equal(expiredBusiness.status, 401)
    const expiredStart = await postControl(expiredJar, '/masquerade/start', expiredCsrf, {
      targetId: String(target.id),
      reason: 'expired native session must not start a mode',
      _masqueradeContext: active.contextToken,
    })
    assert.equal(expiredStart.status, 401)
    const expiredStop = await postControl(expiredJar, '/masquerade/stop', expiredCsrf, {
      _masqueradeContext: active.contextToken,
    })
    assert.equal(expiredStop.status, 401)
    assert.deepEqual(await modeRow(actor.id), activeModeBeforeExpiry)
    assert.equal(await eventCount(actor.id), eventCountBeforeExpiry)

    const control = await controlJar.request('/raw-business', {
      headers: { accept: 'application/json' },
    })
    assert.equal(control.status, 200)
    const rawIdentity = (await control.json()) as { actorId: number }
    assert.equal(rawIdentity.actorId, actor.id)

    const effective = await activeJar.request('/business', {
      headers: { accept: 'application/json' },
    })
    assert.equal(effective.status, 200)
    const effectiveIdentity = (await effective.json()) as {
      actorId: number
      effectiveId: number
      rawActorId: number
      authenticatedViaGuard: string
    }
    assert.equal(effectiveIdentity.actorId, actor.id)
    assert.equal(effectiveIdentity.rawActorId, actor.id)
    assert.equal(effectiveIdentity.effectiveId, target.id)
    assert.equal(effectiveIdentity.authenticatedViaGuard, 'web_effective')
    assert.equal(activeJar.has('adonis-session'), true)
    assert.notEqual(activeJar.cookieValue('remember_web'), actorRememberCookie)

    const recoveredStatusResponse = await activeJar.request('/masquerade', {
      headers: { accept: 'application/json' },
    })
    assert.equal(recoveredStatusResponse.status, 200)
    const recoveredStatus = (await recoveredStatusResponse.json()) as MasqueradeStatus
    assert.equal(recoveredStatus.isMasquerading, true)
    const recoveredCsrf = await getFreshCsrfToken(activeJar, '/business/form')
    const recoveredStop = await postControl(activeJar, '/masquerade/stop', recoveredCsrf, {
      _masqueradeContext: recoveredStatus.contextToken,
    })
    assert.equal(recoveredStop.status, 200)

    const idleStatusResponseAfterStop = await activeJar.request('/masquerade', {
      headers: { accept: 'application/json' },
    })
    assert.equal(idleStatusResponseAfterStop.status, 200)
    const idleStatusAfterStop = (await idleStatusResponseAfterStop.json()) as MasqueradeStatus
    assert.equal(idleStatusAfterStop.isMasquerading, false)
    const idleCsrf = await getFreshCsrfToken(activeJar, '/business/form')
    const recoveredStart = await postControl(activeJar, '/masquerade/start', idleCsrf, {
      targetId: String(target.id),
      reason: 'start after native remember recovery',
      _masqueradeContext: idleStatusAfterStop.contextToken,
    })
    assert.equal(recoveredStart.status, 200)
    const reactivated = (await recoveredStart.json()) as { contextToken: string }
    const reactivatedStop = await postControl(activeJar, '/masquerade/stop', idleCsrf, {
      _masqueradeContext: reactivated.contextToken,
    })
    assert.equal(reactivatedStop.status, 200)
    const finalStatusResponse = await activeJar.request('/masquerade', {
      headers: { accept: 'application/json' },
    })
    assert.equal(finalStatusResponse.status, 200)
    assert.equal(((await finalStatusResponse.json()) as MasqueradeStatus).isMasquerading, false)

    const targetRememberTokens = await db
      .from('remember_me_tokens')
      .where('tokenable_id', target.id)
      .count('* as total')
      .first()
    assert.equal(Number(targetRememberTokens?.total), 0)
  })
})
