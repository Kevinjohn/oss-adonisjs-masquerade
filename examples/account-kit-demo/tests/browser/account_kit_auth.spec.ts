import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { demoAccounts } from '#services/demo_accounts'
import {
  baseUrl,
  captureDemoBrowserState,
  newDemoPage,
  restoreDemoBrowserState,
  seedDemoBrowserAccounts,
  type DemoBrowserState,
} from './demo_browser_fixture.js'

const screenshots = resolve('tmp/browser')
const operator = demoAccounts[0]

test.group('Account Kit browser authentication', (group) => {
  let before: DemoBrowserState | undefined
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    before = undefined
    await seedDemoBrowserAccounts()
    before = await captureDemoBrowserState()
  })
  group.each.teardown(async () => restoreDemoBrowserState(before))

  test('retries a failed login, updates the profile, then logs out and ends the session', async ({
    browser,
    assert,
  }) => {
    await mkdir(screenshots, { recursive: true })
    const { context, page } = await newDemoPage(browser)
    const kitResponses: { method: string; path: string; status: number }[] = []
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.pathname.startsWith('/kit/')) {
        kitResponses.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        })
      }
    })

    try {
      await page.goto(`${baseUrl()}/login`)
      await page.getByLabel('Email').fill(operator.email)
      await page.getByLabel('Password').fill('incorrect-password')
      const failedLogin = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/kit/auth/login'
      )
      await page.getByRole('button', { name: 'Sign in' }).click()
      const failed = await failedLogin
      assert.equal(failed.status(), 401)
      await page.getByRole('alert').waitFor({ state: 'visible' })
      assert.equal(await page.getByRole('alert').isVisible(), true)
      assert.equal(await page.getByLabel('Password').inputValue(), '')
      assert.equal(await page.getByRole('button', { name: 'Sign in' }).isEnabled(), true)
      assert.equal(await page.getByLabel('Email').inputValue(), operator.email)
      await page.screenshot({ path: resolve(screenshots, 'account_kit_login_error.png') })

      await page.getByLabel('Password').fill(operator.password)
      const successfulLogin = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/kit/auth/login' && response.status() === 200
      )
      await page.getByRole('button', { name: 'Sign in' }).click()
      await successfulLogin
      await page.waitForURL('**/support')
      const accountSession = await db
        .from('account_sessions')
        .where('user_id', before!.operatorId)
        .first()
      assert.isNotNull(accountSession)

      await page.goto(`${baseUrl()}/support/account`)
      await page.getByLabel('Display name').fill('Browser Auth Operator')
      await page.getByLabel('Current password').fill(operator.password)
      const profileResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/kit/account/profile'
      )
      const profileReload = page.waitForNavigation()
      await page.getByRole('button', { name: 'Save display name' }).click()
      const updated = await profileResponse
      assert.equal(updated.status(), 200)
      await profileReload
      assert.equal(await page.getByLabel('Display name').inputValue(), 'Browser Auth Operator')
      const updatedOperator = await db.from('users').where('id', before!.operatorId).first()
      assert.equal(updatedOperator.full_name, 'Browser Auth Operator')

      const logoutResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/kit/account/logout'
      )
      await page.getByRole('button', { name: 'Sign out' }).click()
      const logout = await logoutResponse
      assert.equal(logout.status(), 204)
      await page.waitForURL('**/login')
      assert.isNull(await db.from('account_sessions').where('user_id', before!.operatorId).first())
      const supportRedirect = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/support'
      )
      await page.goto(`${baseUrl()}/support`)
      const deniedSupport = await supportRedirect
      assert.equal(deniedSupport.status(), 302)
      assert.include(deniedSupport.headers().location ?? '', '/login')
      assert.include(page.url(), '/login')

      assert.deepEqual(
        kitResponses.map(({ method, path }) => `${method} ${path}`).sort(),
        [
          'GET /kit/auth/csrf',
          'GET /kit/auth/csrf',
          'GET /kit/auth/csrf',
          'GET /kit/auth/csrf',
          'PATCH /kit/account/profile',
          'POST /kit/account/logout',
          'POST /kit/auth/login',
          'POST /kit/auth/login',
        ].sort()
      )
      assert.deepEqual(
        kitResponses.filter(({ path }) => path === '/kit/auth/login').map(({ status }) => status),
        [401, 200]
      )
      assert.deepEqual(
        kitResponses.filter(({ path }) => path === '/kit/auth/csrf').map(({ status }) => status),
        [200, 200, 200, 200]
      )
      assert.equal(kitResponses.find(({ path }) => path === '/kit/account/profile')?.status, 200)
      assert.equal(kitResponses.find(({ path }) => path === '/kit/account/logout')?.status, 204)
    } finally {
      await context.close()
    }
  })

  test('keeps Kit controls disabled and explains the JavaScript requirement', async ({
    browser,
    assert,
  }) => {
    const { context: enabledContext, page: enabledPage } = await newDemoPage(browser)
    const anonymousContext = await browser.newContext({ javaScriptEnabled: false })
    let signedInDisabledContext
    try {
      const loginPage = await anonymousContext.newPage()
      const submitted = new Set<string>()
      loginPage.on('request', (request) => {
        if (request.url().includes('/kit/auth/login')) submitted.add(request.url())
      })
      await loginPage.goto(`${baseUrl()}/login`)
      assert.equal(await loginPage.locator('noscript').isVisible(), true)
      const loginExplanation = await loginPage.locator('noscript').innerText()
      assert.include(loginExplanation.trim(), 'Enable JavaScript to sign in to this demo.')
      assert.equal(await loginPage.getByRole('button', { name: 'Sign in' }).isDisabled(), true)
      await loginPage.getByLabel('Email').fill(operator.email)
      await loginPage.getByLabel('Password').fill(operator.password)
      await loginPage.keyboard.press('Enter')
      assert.equal(loginPage.url().endsWith('/login'), true)
      assert.equal(submitted.size, 0)

      await enabledPage.goto(`${baseUrl()}/login`)
      await enabledPage.getByLabel('Email').fill(operator.email)
      await enabledPage.getByLabel('Password').fill(operator.password)
      await enabledPage.getByRole('button', { name: 'Sign in' }).click()
      await enabledPage.waitForURL('**/support')
      const state = await enabledContext.storageState()
      signedInDisabledContext = await browser.newContext({
        javaScriptEnabled: false,
        storageState: state,
      })

      const support = await signedInDisabledContext.newPage()
      await support.goto(`${baseUrl()}/support`)
      assert.equal(await support.getByRole('button', { name: 'Sign out' }).isDisabled(), true)
      assert.equal(await support.locator('noscript').first().isVisible(), true)
      const logoutExplanation = await support.locator('noscript').first().innerText()
      assert.include(logoutExplanation.trim(), 'Enable JavaScript to sign out of this demo.')
      const account = await signedInDisabledContext.newPage()
      await account.goto(`${baseUrl()}/support/account`)
      assert.equal(
        await account.getByRole('button', { name: 'Save display name' }).isDisabled(),
        true
      )
      const noscript = account.locator('noscript')
      assert.equal(await noscript.nth(1).isVisible(), true)
      const profileExplanation = await noscript.nth(1).innerText()
      assert.include(profileExplanation.trim(), 'Enable JavaScript to change your display name.')
    } finally {
      await signedInDisabledContext?.close()
      await anonymousContext.close()
      await enabledContext.close()
    }
  })
})
