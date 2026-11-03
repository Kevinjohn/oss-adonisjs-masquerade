import { mock } from 'node:test'
import { test } from '@japa/runner'
import type { TestContext } from '@japa/runner/core'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import User from '#models/user'
import { demoAccounts, resetDemoAccounts, seedDemoAccounts } from '#services/demo_accounts'
import {
  setMasqueradeStoreUnavailable,
  setMasqueradeTestTime,
} from '#services/masquerade_fixture_boundary'

type BrowserPage = Awaited<ReturnType<TestContext['browserContext']['newPage']>>

const screenshots = resolve('tmp/browser')

test.group('support workspace browser journey', (group) => {
  group.setup(() => {
    mkdirSync(screenshots, { recursive: true })
    return testUtils.db().migrate()
  })
  group.each.setup(async () => {
    setMasqueradeStoreUnavailable(false)
    setMasqueradeTestTime(undefined)
    await resetDemoAccounts()
    await seedDemoAccounts()
  })
  group.each.teardown(async () => {
    setMasqueradeStoreUnavailable(false)
    setMasqueradeTestTime(undefined)
    await limiter.clear(['memory'])
    await resetDemoAccounts()
  })

  test('starts and stops from the rendered workspace with keyboard and narrow layout', async ({
    browserContext,
    assert,
  }) => {
    const operator = await User.findByOrFail('email', demoAccounts[0].email)
    const customer = await User.findByOrFail('email', demoAccounts[1].email)
    const page = await browserContext.newPage()
    const scriptResponses: { url: string; status: number }[] = []
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') {
        scriptResponses.push({ url: response.url(), status: response.status() })
      }
    })
    await page.goto(`${baseUrl()}/login`)
    await signIn(page, operator.email)

    await page.getByRole('link', { name: 'Open support workspace' }).focus()
    await page.keyboard.press('Enter')
    await page.waitForURL('**/support')
    assert.equal(await page.getByLabel('Customer', { exact: true }).count(), 1)
    assert.equal(await page.getByLabel('Reason for access').count(), 1)
    assert.equal(await page.getByRole('radio', { name: 'View only' }).isChecked(), true)
    assert.equal(await page.getByRole('radio', { name: 'Can edit' }).isChecked(), false)

    const start = page.getByRole('button', { name: 'Start support mode' })
    await start.focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate('document.activeElement.id'), 'targetId')
    const customerSelect = page.getByLabel('Customer', { exact: true })
    await customerSelect.focus()
    await page.keyboard.press('c')
    assert.equal(await customerSelect.inputValue(), String(customer.id))
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await start.focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate('document.activeElement.id'), 'reason')
    await page.keyboard.type('Customer requested help with email settings')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.waitForURL('**/support/customer')

    const bannerText = await page.locator('[data-support-mode]').innerText()
    assert.include(bannerText, operator.fullName!)
    assert.include(bannerText, customer.fullName!)
    assert.include(bannerText, 'account-wide mode')
    assert.include(bannerText, 'Can edit')
    assert.include(await page.locator('body').innerText(), customer.email)
    assert.equal(await page.locator('time[datetime]').count(), 1)
    assert.equal(
      await page.locator('[data-support-intent] input[name="_masqueradeContext"]').count(),
      2
    )
    assert.equal(
      await page.locator('[data-mode-notice][role="status"][aria-live="polite"]').count(),
      1
    )
    assert.isAtLeast(scriptResponses.length, 1)
    const supportModeScripts = scriptResponses.filter(
      ({ url }) => new URL(url).pathname === '/resources/js/components/support_mode.js'
    )
    assert.isAtLeast(supportModeScripts.length, 1)
    assert.equal(
      supportModeScripts.some(({ status }) => status === 200),
      true
    )
    await page.setViewportSize({ width: 320, height: 844 })
    assert.equal(await page.evaluate('window.innerWidth'), 320)
    assert.equal(
      await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
      true
    )
    assert.equal(
      await page.evaluate(
        "getComputedStyle(document.querySelector('.support-mode__header')).flexDirection"
      ),
      'column'
    )
    await page.screenshot({ path: resolve(screenshots, 'active_support_banner.png') })

    assert.equal(await page.locator('.support-details dd').nth(1).textContent(), 'Off')
    assert.equal(await page.getByLabel('Setting').inputValue(), '0')
    await page.getByLabel('Setting').selectOption('1')
    await page.getByRole('button', { name: 'Save preference' }).press('Enter')
    await page.waitForURL('**/support/customer')
    await page.getByText('Customer email preference saved.').waitFor()
    await page.reload()
    assert.equal(await page.locator('.support-details dd').nth(1).textContent(), 'On')
    assert.equal(await page.getByLabel('Setting').inputValue(), '1')

    await page.getByRole('button', { name: 'Try sensitive action' }).click()
    await page.getByRole('heading', { name: 'Sensitive action blocked' }).waitFor()
    assert.equal(await page.evaluate('document.activeElement.id'), 'support-error-title')
    assert.equal(await page.getByRole('alert').count(), 1)
    await page.screenshot({ path: resolve(screenshots, 'sensitive_action_recovery.png') })

    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.waitForURL('**/support')
    await page.getByRole('button', { name: 'Stop support mode' }).press('Enter')
    await page.waitForURL('**/support')
    await page.getByRole('heading', { name: 'Choose a customer' }).waitFor()
    await page.getByRole('heading', { name: operator.fullName! }).waitFor()
  })

  test('view-only start blocks the edit and renders the host page', async ({
    browserContext,
    assert,
  }) => {
    const operator = await User.findByOrFail('email', demoAccounts[0].email)
    const customer = await User.findByOrFail('email', demoAccounts[1].email)
    const page = await browserContext.newPage()
    await page.goto(`${baseUrl()}/login`)
    await signIn(page, operator.email)
    await page.goto(`${baseUrl()}/support`)
    assert.equal(await page.getByRole('radio', { name: 'View only' }).isChecked(), true)
    await page.getByLabel('Customer', { exact: true }).selectOption(String(customer.id))
    await page.getByLabel('Reason for access').fill('Read-only customer review')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    assert.include(await page.locator('[data-support-mode]').innerText(), 'View only')

    await page.getByLabel('Setting', { exact: true }).selectOption('1')
    await page.getByRole('button', { name: 'Save preference' }).click()
    await page.locator('#support-error-title').waitFor()
    const errorTitle = await page.locator('#support-error-title').textContent()
    assert.equal(errorTitle?.trim(), 'View-only support mode')
    assert.include(await page.locator('body').innerText(), 'cannot change it')
    assert.notInclude(await page.locator('body').innerText(), 'route configuration')
    assert.isNull(await db.from('demo_preferences').where('user_id', customer.id).first())

    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.waitForURL('**/support')
    await page.getByRole('link', { name: 'Review customer workspace' }).click()
    await page.waitForURL('**/support/customer')
    await page.reload()
    assert.equal(await page.locator('.support-details dd').nth(1).textContent(), 'Off')
    assert.include(await page.locator('[data-support-mode]').innerText(), 'View only')
  })

  test('rejects an old form and shares account mode across separate sessions', async ({
    visit,
    browser,
    browserContext,
    assert,
  }) => {
    const operator = await User.findByOrFail('email', demoAccounts[0].email)
    const first = await visit('/login')
    await signIn(first, operator.email)
    await first.goto(`${baseUrl()}/support`)

    const second = await browserContext.newPage()
    await second.goto(`${baseUrl()}/support`)
    await second
      .getByLabel('Customer', { exact: true })
      .selectOption({ label: 'Customer One — customer-one@example.test' })
    await second.getByRole('radio', { name: 'Can edit' }).check()
    await second.getByLabel('Reason for access').fill('First tab requested support')
    await second.getByRole('button', { name: 'Start support mode' }).click()
    await second.waitForURL('**/support/customer')

    await first
      .getByLabel('Customer', { exact: true })
      .selectOption({ label: 'Customer Two — customer-two@example.test' })
    await first.getByRole('radio', { name: 'Can edit' }).check()
    await first.getByLabel('Reason for access').fill('Stale tab must not replace the customer')
    await first.getByRole('button', { name: 'Start support mode' }).click()
    await first.getByRole('heading', { name: 'Support context changed' }).waitFor()
    assert.equal(await first.evaluate('document.activeElement.id'), 'support-error-title')
    await second.goto('/support')
    await second.getByRole('heading', { name: /Customer: Customer One/ }).waitFor()
    assert.equal(await second.getByRole('button', { name: 'Stop support mode' }).count(), 1)

    const separateContext = await browser.newContext()
    try {
      const separatePage = await separateContext.newPage()
      await separatePage.goto(`${baseUrl()}/login`)
      await signIn(separatePage, operator.email)
      await separatePage.goto(`${baseUrl()}/support`)
      await separatePage.getByRole('heading', { name: /Customer: Customer One/ }).waitFor()

      const firstCookies = await browserContext.cookies()
      const secondCookies = await separateContext.cookies()
      const firstCookie = firstCookies.find((cookie) => cookie.name === 'adonis-session')
      const secondCookie = secondCookies.find((cookie) => cookie.name === 'adonis-session')
      assert.isDefined(firstCookie)
      assert.isDefined(secondCookie)
      assert.notEqual(firstCookie!.value, secondCookie!.value)

      await separatePage.getByRole('button', { name: 'Stop support mode' }).click()
      await separatePage.waitForURL('**/support')
      await first.goto(`${baseUrl()}/support`)
      await first.getByRole('heading', { name: 'Choose a customer' }).waitFor()
    } finally {
      await separateContext.close()
    }
  })

  test('freezes focused intent at exact expiry and recovers from store unavailability', async ({
    visit,
    browserContext,
    assert,
  }) => {
    const fixedNow = Date.now()
    mock.timers.enable({ apis: ['Date'], now: fixedNow })
    let backgroundPage: Awaited<ReturnType<typeof browserContext.newPage>> | undefined
    try {
      const operator = await User.findByOrFail('email', demoAccounts[0].email)
      const page = await visit('/login')
      await page.clock.install({ time: fixedNow })
      await signIn(page, operator.email)
      await page.goto(`${baseUrl()}/support`)
      await page
        .getByLabel('Customer', { exact: true })
        .selectOption({ label: 'Customer One — customer-one@example.test' })
      await page.getByRole('radio', { name: 'Can edit' }).check()
      await page.getByLabel('Reason for access').fill('Expiry recovery demonstration')
      await page.getByRole('button', { name: 'Start support mode' }).click()
      await page.waitForURL('**/support/customer')

      const deadline = Date.parse((await page.locator('time').getAttribute('datetime'))!)
      assert.isAtLeast(deadline - fixedNow, 60_000)
      const intentButton = page.getByRole('button', { name: 'Save preference' })
      await intentButton.focus()
      assert.equal(
        await page.evaluate('document.activeElement?.textContent?.trim()'),
        'Save preference'
      )
      backgroundPage = await browserContext.newPage()
      await backgroundPage.goto(`${baseUrl()}/support`)

      mock.timers.setTime(deadline)
      await page.clock.setFixedTime(deadline)
      setMasqueradeTestTime(deadline)
      await backgroundPage!.bringToFront()
      await page.bringToFront()
      await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
      const notice = page.locator('[data-mode-notice]')
      await notice.waitFor({ state: 'visible' })
      assert.include(await notice.textContent(), 'fixed deadline has passed')
      assert.equal(await notice.getAttribute('role'), 'status')
      assert.equal(await notice.getAttribute('aria-live'), 'polite')
      assert.equal(await notice.getAttribute('tabindex'), '-1')
      assert.equal(
        await page.evaluate("document.activeElement?.matches('[data-mode-notice]')"),
        true
      )
      assert.equal(await page.locator('[data-support-intent]').first().isHidden(), true)
      const intentButtons = page.locator('form[data-support-intent] button')
      assert.equal(await intentButtons.count(), 2)
      assert.equal(await intentButtons.nth(0).isDisabled(), true)
      assert.equal(await intentButtons.nth(1).isDisabled(), true)

      const expiredCustomerResponse = await page.goto(`${baseUrl()}/support/customer`)
      assert.equal(expiredCustomerResponse?.status(), 409)
      await page.getByRole('heading', { name: 'Support context changed' }).waitFor()
      assert.include(await page.locator('body').innerText(), 'The old action was not replayed.')
      await page.goto(`${baseUrl()}/support`)
      await page.getByRole('heading', { name: 'Choose a customer' }).waitFor()
      await page.getByRole('heading', { name: operator.fullName! }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Stop support mode' }).count(), 0)

      await page
        .getByLabel('Customer', { exact: true })
        .selectOption({ label: 'Customer One — customer-one@example.test' })
      await page.getByRole('radio', { name: 'Can edit' }).check()
      await page.getByLabel('Reason for access').fill('Recover after the outage demonstration')
      await page.getByRole('button', { name: 'Start support mode' }).click()
      await page.waitForURL('**/support/customer')
      await page.goto(`${baseUrl()}/support`)
      setMasqueradeStoreUnavailable(true)
      await page.reload()
      await page.getByRole('heading', { name: 'Support status is unavailable' }).waitFor()
      assert.equal(await page.getByRole('alert').count(), 1)
      assert.equal(await page.evaluate('document.activeElement.id'), 'support-error-title')
      await page.screenshot({ path: resolve(screenshots, 'unavailable_recovery.png') })

      setMasqueradeStoreUnavailable(false)
      await page.getByRole('link', { name: 'Check current status' }).click()
      await page.getByRole('button', { name: 'Stop support mode' }).waitFor()
    } finally {
      try {
        setMasqueradeStoreUnavailable(false)
      } finally {
        try {
          setMasqueradeTestTime(undefined)
        } finally {
          mock.timers.reset()
          await backgroundPage?.close()
        }
      }
    }
  })
})

async function signIn(page: BrowserPage, email: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('demo-operator-2026')
  await page.getByRole('button', { name: 'Sign in' }).press('Enter')
  await page.waitForURL('**/dashboard')
}

function baseUrl() {
  return `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '3391'}`
}
