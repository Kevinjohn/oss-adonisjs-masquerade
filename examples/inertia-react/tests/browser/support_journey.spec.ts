/// <reference lib="dom" />
import { test } from '@japa/runner'
import { mock } from 'node:test'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { resetDemoAccounts, seedDemoAccounts } from '#services/demo_accounts'
import {
  setMasqueradeStoreUnavailable,
  setMasqueradeTestTime,
} from '#services/masquerade_fixture_boundary'

const base = () => `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '3371'}`

test.group('React support browser journey', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetDemoAccounts()
    await seedDemoAccounts()
  })
  group.each.teardown(async () => {
    setMasqueradeStoreUnavailable(false)
    setMasqueradeTestTime(undefined)
    await limiter.clear(['memory'])
    await resetDemoAccounts()
  })

  test('completes the keyboard journey and keeps controls usable at 320px', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await page.goto(`${base()}/login`)
    await page.getByLabel('Email').fill('operator@example.test')
    await page.getByLabel('Password').fill('demo-operator-2026')
    await page.getByRole('button', { name: 'Log in' }).press('Enter')
    await page.waitForURL('**/support')
    const idleHistoryKey = await page.evaluate("sessionStorage.getItem('historyKey')")
    assert.isTrue(await page.getByLabel('View only').isChecked())
    await page.getByLabel('Customer').selectOption({ label: 'Customer One' })
    await page.getByLabel('Reason for support').fill('Customer requested email update help')
    await page.getByLabel('Can edit').check()
    await page.getByRole('button', { name: 'Start support mode' }).press('Enter')
    await page.waitForURL('**/support/customer')
    const activeHistoryKey = await page.evaluate("sessionStorage.getItem('historyKey')")
    assert.isNotNull(activeHistoryKey)
    assert.notEqual(activeHistoryKey, idleHistoryKey)
    assert.include(await page.getByRole('status').first().innerText(), 'Customer One')
    assert.include(await page.locator('main').innerText(), 'customer-one@example.test')
    await page.setViewportSize({ width: 320, height: 844 })
    assert.isTrue(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    await page.getByLabel('Email updates').selectOption('1')
    await page.getByRole('button', { name: 'Save preference' }).press('Enter')
    await page.getByText('Customer email preference saved.').waitFor()
    await page.reload()
    assert.include(await page.locator('main').innerText(), 'On')
    await page.getByRole('button', { name: 'Try sensitive account action' }).press('Enter')
    await page.getByRole('heading', { name: 'Sensitive action is unavailable' }).waitFor()
    assert.equal(await page.evaluate('document.activeElement?.tagName'), 'H1')
    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.getByRole('button', { name: 'Stop support mode' }).click()
    await page.getByRole('button', { name: 'Start support mode' }).waitFor()
    const stoppedHistoryKey = await page.evaluate("sessionStorage.getItem('historyKey')")
    assert.notEqual(stoppedHistoryKey, activeHistoryKey)
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.getByRole('heading', { name: 'Log in' }).waitFor()
    assert.notEqual(await page.evaluate("sessionStorage.getItem('historyKey')"), stoppedHistoryKey)
  })

  test('banner shows the level fixed at start after a reload', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    await page.getByLabel('Customer').selectOption({ label: 'Customer One' })
    await page.getByLabel('Reason for support').fill('Can-edit support request')
    await page.getByLabel('Can edit').check()
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    assert.include(await page.getByRole('status').first().innerText(), 'Can edit')

    await page.reload()
    assert.include(await page.getByRole('status').first().innerText(), 'Can edit')
  })

  test('view-only start blocks the edit and renders the host page', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    await page.getByLabel('Customer').selectOption({ label: 'Customer One' })
    await page.getByLabel('Reason for support').fill('Read-only support request')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    assert.include(await page.getByRole('status').first().innerText(), 'View only')

    await page.getByLabel('Email updates').selectOption('1')
    await page.getByRole('button', { name: 'Save preference' }).click()
    await page.waitForURL('**/support/recovery')
    assert.equal(
      await page.getByRole('heading', { level: 1 }).innerText(),
      'View-only support mode blocked this change'
    )
    assert.isTrue(await page.getByRole('alert').isVisible())
    assert.include(
      await page.locator('main').innerText(),
      'This support mode can read customer information but cannot change it.'
    )
    assert.equal(await page.evaluate('document.activeElement?.tagName'), 'H1')
    const customer = await User.findByOrFail('email', 'customer-one@example.test')
    assert.isNull(await db.from('demo_preferences').where('user_id', customer.id).first())
  })

  test('announces login and signup failures beside the affected fields', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await page.goto(`${base()}/login`)
    await page.getByLabel('Email').fill('operator@example.test')
    await page.getByLabel('Password').fill('incorrect-password')
    await page.getByRole('button', { name: 'Log in' }).click()
    const loginAlert = page.getByRole('alert')
    await loginAlert.waitFor()
    assert.include(await loginAlert.innerText(), 'Email or password did not match')

    await page.goto(`${base()}/signup`)
    await page.getByLabel('Name').fill('Example User')
    await page.getByLabel('Email').fill('operator@example.test')
    await page.getByLabel('Password', { exact: true }).fill('correct-password')
    await page.getByLabel('Confirm password').fill('different-password')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.locator('#email-error').waitFor()
    await page.locator('#confirmation-error').waitFor()
    assert.equal(await page.getByLabel('Email').getAttribute('aria-invalid'), 'true')
    assert.equal(
      await page.getByLabel('Confirm password').getAttribute('aria-describedby'),
      'confirmation-error'
    )
  })

  test('revalidates retained pages through A to B and independent operator sessions', async ({
    browser,
    browserContext,
    assert,
  }) => {
    const first = await browserContext.newPage()
    await signIn(first)
    const staleTab = await browserContext.newPage()
    await staleTab.goto(`${base()}/support`)
    const idleToken = await staleTab.locator('input[name="_masqueradeContext"]').inputValue()
    await staleTab.getByLabel('Customer').selectOption({ label: 'Customer One' })
    await staleTab.getByLabel('Reason for support').fill('Retained idle form')

    await first.getByLabel('Customer').selectOption({ label: 'Customer One' })
    await first.getByLabel('Reason for support').fill('Customer One requested help')
    await first.getByLabel('Can edit').check()
    await first.getByRole('button', { name: 'Start support mode' }).click()
    await first.waitForURL('**/support/customer')
    assert.include(await first.locator('main').innerText(), 'customer-one@example.test')
    const activeAToken = await first
      .locator('input[name="_masqueradeContext"]')
      .first()
      .inputValue()
    assert.notEqual(activeAToken, idleToken)

    const separate = await browser.newContext()
    try {
      const second = await separate.newPage()
      await signIn(second)
      await second.goto(`${base()}/support`)
      await second.getByRole('button', { name: 'Stop support mode' }).click()
      await second.getByRole('button', { name: 'Start support mode' }).waitFor()
      await second.getByLabel('Customer').selectOption({ label: 'Customer Two' })
      await second.getByLabel('Reason for support').fill('Customer Two requested help')
      await second.getByLabel('Can edit').check()
      await second.getByRole('button', { name: 'Start support mode' }).click()
      await second.waitForURL('**/support/customer')

      await limiter.clear(['memory'])
      assert.equal(await submitRetainedForm(staleTab, '/support/start', idleToken), 409)
      assert.equal(
        await submitRetainedForm(first, '/support/customer/preference', activeAToken),
        409
      )
      const customerOne = await User.findByOrFail('email', 'customer-one@example.test')
      assert.isNull(await db.from('demo_preferences').where('user_id', customerOne.id).first())
      assert.include(await second.locator('main').innerText(), 'customer-two@example.test')

      await staleTab.bringToFront()
      await staleTab.goto(`${base()}/support/customer`)
      assert.include(await staleTab.locator('main').innerText(), 'customer-two@example.test')
      assert.notInclude(await staleTab.locator('main').innerText(), 'customer-one@example.test')
      await staleTab.goBack()
      await staleTab.getByRole('heading', { name: 'Support workspace' }).waitFor()
      assert.notInclude(await staleTab.locator('main').innerText(), 'customer-one@example.test')
      await staleTab.goForward()
      assert.notInclude(await staleTab.locator('main').innerText(), 'customer-one@example.test')
    } finally {
      await separate.close()
    }
  })

  test('keeps restored customer history hidden after navigating through Home', async ({
    browser,
    browserContext,
    assert,
  }) => {
    const first = await browserContext.newPage()
    await signIn(first)
    await first.getByLabel('Customer').selectOption({ label: 'Customer One' })
    await first.getByLabel('Reason for support').fill('History boundary')
    await first.getByRole('button', { name: 'Start support mode' }).click()
    await first.waitForURL('**/support/customer')
    await first.getByRole('link', { name: 'Home' }).click()
    await first.waitForURL(base() + '/')

    const separate = await browser.newContext()
    try {
      const second = await separate.newPage()
      await signIn(second)
      await second.getByRole('button', { name: 'Stop support mode' }).click()
      await second.getByLabel('Customer').selectOption({ label: 'Customer Two' })
      await second.getByLabel('Reason for support').fill('Current customer')
      await second.getByRole('button', { name: 'Start support mode' }).click()
      await second.waitForURL('**/support/customer')

      await first.goBack()
      await first.getByRole('heading', { name: 'Support workspace' }).waitFor()
      assert.notInclude(await first.locator('main').innerText(), 'customer-one@example.test')
      assert.include(await first.locator('main').innerText(), 'viewing Customer Two')
    } finally {
      await separate.close()
    }
  })

  test('freezes the customer page at its exact deadline and renders unavailable recovery', async ({
    browserContext,
    assert,
  }) => {
    const now = Date.now()
    mock.timers.enable({ apis: ['Date'], now })
    try {
      const page = await browserContext.newPage()
      await page.clock.install({ time: now })
      await signIn(page)
      await page.getByLabel('Customer').selectOption({ label: 'Customer One' })
      await page.getByLabel('Reason for support').fill('Fixed deadline review')
      await page.getByRole('button', { name: 'Start support mode' }).click()
      await page.waitForURL('**/support/customer')
      const deadline = Date.parse((await page.locator('time').getAttribute('datetime'))!)
      mock.timers.setTime(deadline)
      setMasqueradeTestTime(deadline)
      await page.evaluate(() => {
        new MutationObserver(() => {
          if (document.documentElement.dataset.identityPending === 'true') {
            sessionStorage.setItem('deadlineFrozen', 'true')
          }
        }).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-identity-pending'],
        })
      })
      await page.clock.runFor(deadline - now + 1)
      await page.waitForURL(`${base()}/support`, { waitUntil: 'load' })
      await page.getByRole('heading', { name: 'Support workspace' }).waitFor()
      assert.equal(await page.evaluate("sessionStorage.getItem('deadlineFrozen')"), 'true')
      assert.notInclude(await page.locator('main').innerText(), 'customer-one@example.test')
      assert.equal(await page.getByRole('button', { name: 'Save preference' }).count(), 0)
      setMasqueradeTestTime(undefined)
      mock.timers.setTime(now)
      await page.clock.setFixedTime(now)
      await page.getByRole('button', { name: 'Stop support mode' }).click()
      await page.getByRole('button', { name: 'Start support mode' }).waitFor()
      await page.getByLabel('Customer').selectOption({ label: 'Customer One' })
      await page.getByLabel('Reason for support').fill('Recovery after expiry')
      await page.getByRole('button', { name: 'Start support mode' }).click()
      await page.waitForURL('**/support/customer')
      setMasqueradeStoreUnavailable(true)
      await page.goto(`${base()}/support`)
      await page.getByRole('heading', { name: 'Support action needs review' }).waitFor()
      assert.equal(await page.evaluate('document.activeElement?.tagName'), 'H1')
      assert.include(await page.locator('main').innerText(), 'Check raw status')
      setMasqueradeStoreUnavailable(false)
      await page.getByRole('link', { name: 'Check current status' }).click()
      await page.getByRole('button', { name: 'Stop support mode' }).waitFor()
    } finally {
      setMasqueradeTestTime(undefined)
      setMasqueradeStoreUnavailable(false)
      mock.timers.reset()
    }
  })

  test('discards a delayed A response after another tab moves to B', async ({
    browserContext,
    assert,
  }) => {
    const first = await browserContext.newPage()
    await signIn(first)
    await first.getByLabel('Customer').selectOption({ label: 'Customer One' })
    await first.getByLabel('Reason for support').fill('First customer')
    await first.getByRole('button', { name: 'Start support mode' }).click()
    await first.waitForURL('**/support/customer')
    await first.getByRole('link', { name: 'Return to operator workspace' }).click()
    await first.waitForURL('**/support')

    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let intercepted: (() => void) | undefined
    const sawRequest = new Promise<void>((resolve) => {
      intercepted = resolve
    })
    await first.route('**/support/customer', async (route) => {
      const response = await route.fetch()
      intercepted?.()
      await gate
      await route.fulfill({ response })
    })
    await first.getByRole('link', { name: 'Open customer view' }).click()
    await sawRequest

    const second = await browserContext.newPage()
    await second.goto(`${base()}/support`)
    await second.getByRole('button', { name: 'Stop support mode' }).click()
    await second.getByLabel('Customer').selectOption({ label: 'Customer Two' })
    await second.getByLabel('Reason for support').fill('Second customer')
    await second.getByRole('button', { name: 'Start support mode' }).click()
    await second.waitForURL('**/support/customer')
    const rawDocument = first.waitForResponse(
      (response) =>
        response.url().endsWith('/support') && response.request().resourceType() === 'document'
    )
    await first.bringToFront()
    await first.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    release?.()
    await rawDocument
    await first.waitForFunction(
      () =>
        document.querySelector('h1')?.textContent === 'Support workspace' &&
        document.documentElement.dataset.identityPending !== 'true'
    )
    assert.notInclude(await first.locator('main').innerText(), 'customer-one@example.test')
    await first.goto(`${base()}/support/customer`)
    assert.include(await first.locator('main').innerText(), 'customer-two@example.test')
  })

  test('recovers when the target becomes ineligible', async ({ browserContext, assert }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    await page.getByLabel('Customer').selectOption({ label: 'Customer One' })
    await page.getByLabel('Reason for support').fill('Admission recovery')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    const customer = await User.findByOrFail('email', 'customer-one@example.test')
    customer.active = false
    await customer.save()
    await page.goto(`${base()}/support/customer`)
    await page.getByRole('heading', { name: 'Support action needs review' }).waitFor()
    assert.notInclude(await page.locator('main').innerText(), 'customer-one@example.test')
    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.getByRole('heading', { name: 'Support workspace' }).waitFor()
  })
})

async function signIn(
  page: Awaited<ReturnType<import('@japa/runner/core').TestContext['browserContext']['newPage']>>
) {
  await page.goto(`${base()}/login`)
  await page.getByLabel('Email').fill('operator@example.test')
  await page.getByLabel('Password').fill('demo-operator-2026')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/support')
}

async function submitRetainedForm(
  page: Parameters<typeof signIn>[0],
  formAction: string,
  originalToken: string
) {
  return page.evaluate(
    async ({ action, token }) => {
      const form = document.querySelector<HTMLFormElement>(`form[action="${action}"]`)
      if (!form) throw new Error(`Retained form ${action} is missing`)
      const data = new FormData(form)
      if (data.get('_masqueradeContext') !== token) throw new Error('Retained form context changed')
      const xsrf = document.cookie.split('; ').find((part) => part.startsWith('XSRF-TOKEN='))
      if (!xsrf) throw new Error('XSRF cookie is missing')
      const response = await fetch(form.action, {
        method: 'POST',
        body: data,
        credentials: 'same-origin',
        redirect: 'manual',
        headers: { 'X-XSRF-TOKEN': decodeURIComponent(xsrf.split('=')[1]) },
      })
      return response.status
    },
    { action: formAction, token: originalToken }
  )
}
