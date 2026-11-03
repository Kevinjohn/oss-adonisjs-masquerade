import { test } from '@japa/runner'
import { mock } from 'node:test'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import { demoAccounts, resetDemoAccounts, seedDemoAccounts } from '#services/demo_accounts'
import {
  setCustomerRequestsUnavailable,
  setMasqueradeStoreUnavailable,
} from '#services/masquerade_fixture_boundary'

test.group('Inertia Vue browser journey', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
    await resetDemoAccounts()
    await seedDemoAccounts()
  })
  group.each.setup(async () => {
    setMasqueradeStoreUnavailable(false)
    setCustomerRequestsUnavailable(false)
    await resetDemoAccounts()
    await seedDemoAccounts()
  })
  group.each.teardown(async () => {
    setMasqueradeStoreUnavailable(false)
    setCustomerRequestsUnavailable(false)
    await resetDemoAccounts()
  })

  test('completes support work, denies sensitive action, clears history, and restores focus', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    const idleToken = await page.locator('input[name="_masqueradeContext"]').inputValue()
    assert.isTrue(idleToken.length > 20)
    assert.isTrue(await page.getByRole('radio', { name: 'View only' }).isChecked())
    await selectCustomer(page, 1)
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for support').fill('Customer requested help')
    await page.getByRole('button', { name: 'Start support mode' }).press('Enter')
    await page.waitForURL('**/support/customer')
    await page.getByRole('status').waitFor()
    assert.include(await page.getByRole('status').innerText(), 'Demo Operator')
    assert.include(await page.getByRole('status').innerText(), 'Customer One')
    assert.include(await page.getByRole('status').innerText(), 'all devices')
    assert.equal(await page.locator('input[name="_masqueradeContext"]').count(), 2)
    assert.equal(await page.locator('[data-identity="current"]').count(), 1)

    await page.setViewportSize({ width: 320, height: 760 })
    assert.isTrue(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    await page.getByLabel('Email updates').selectOption('1')
    await page.getByRole('button', { name: 'Save preference' }).press('Enter')
    await page.reload()
    await page.locator('strong').filter({ hasText: 'On' }).waitFor()

    await page.getByRole('button', { name: 'Try sensitive account action' }).press('Enter')
    await page.waitForURL('**/support/recovery')
    await page.getByRole('heading', { level: 1 }).waitFor()
    assert.equal(
      await page.getByRole('heading', { level: 1 }).innerText(),
      'Sensitive action blocked'
    )
    assert.equal(await page.evaluate('document.activeElement?.tagName'), 'H1')
    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.getByRole('button', { name: 'Stop support mode' }).waitFor()
    await page.getByRole('button', { name: 'Stop support mode' }).press('Enter')
    await page.getByRole('button', { name: 'Start support mode' }).waitFor()
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.waitForURL('**/login')
  })

  test('view-only start blocks the edit and renders the host page', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    assert.isTrue(await page.getByRole('radio', { name: 'View only' }).isChecked())
    await selectCustomer(page, 1)
    await page.getByLabel('Reason for support').fill('Read customer details')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    await page.getByRole('status').waitFor()
    assert.include(await page.getByRole('status').innerText(), 'View only support mode is active')
    await page.getByRole('button', { name: 'Save preference' }).click()
    await page.waitForURL('**/support/recovery')
    await page.getByRole('heading', { level: 1 }).waitFor()
    assert.equal(
      await page.getByRole('heading', { level: 1 }).innerText(),
      'Edit blocked in view-only mode'
    )
    assert.include(
      await page.locator('[role="alert"]').innerText(),
      'This support session is view only'
    )

    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.getByRole('link', { name: 'Open customer details' }).click()
    await page.getByText('Customer email updates: Off').waitFor()
    await page.reload()
    await page.getByText('Customer email updates: Off').waitFor()
    assert.include(await page.getByRole('status').innerText(), 'View only support mode is active')
  })

  test('banner shows the level fixed at start after a reload', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    await selectCustomer(page, 1)
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for support').fill('Read customer details')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    await page.getByRole('status').waitFor()
    assert.include(await page.getByRole('status').innerText(), 'Can edit support mode is active')

    await page.reload()
    await page.getByRole('status').waitFor()
    assert.include(await page.getByRole('status').innerText(), 'Can edit support mode is active')
  })

  test('rejects retained forms across tabs and redirects old Back history to current customer B', async ({
    browser,
    browserContext,
    assert,
  }) => {
    const current = await browserContext.newPage()
    await signIn(current)
    const staleTab = await browserContext.newPage()
    await staleTab.goto(`${base()}/support`)
    const oldIdleToken = await staleTab.locator('input[name="_masqueradeContext"]').inputValue()
    await selectCustomer(staleTab, 1)
    await staleTab.getByRole('radio', { name: 'Can edit' }).check()
    await staleTab.getByLabel('Reason for support').fill('Old idle intent')

    await selectCustomer(current, 1)
    await current.getByRole('radio', { name: 'Can edit' }).check()
    await current.getByLabel('Reason for support').fill('Customer A request')
    await current.getByRole('button', { name: 'Start support mode' }).click()
    await current.waitForURL('**/support/customer')
    const tokenA = await current.locator('input[name="_masqueradeContext"]').first().inputValue()
    assert.notEqual(tokenA, oldIdleToken)

    const secondContext = await browser.newContext()
    try {
      const second = await secondContext.newPage()
      await signIn(second)
      await second.getByRole('button', { name: 'Stop support mode' }).click()
      await selectCustomer(second, 2)
      await second.getByRole('radio', { name: 'Can edit' }).check()
      await second.getByLabel('Reason for support').fill('Customer B request')
      await second.getByRole('button', { name: 'Start support mode' }).click()
      await second.waitForURL('**/support/customer')

      await staleTab.getByRole('button', { name: 'Start support mode' }).click()
      await staleTab.waitForURL('**/support/recovery')
      await staleTab.getByRole('link', { name: 'Check current status' }).click()
      await staleTab.getByText(/viewing Customer Two/).waitFor()
      assert.notInclude(await staleTab.locator('main').innerText(), 'customer-one@example.test')

      await current.goBack()
      await current.getByRole('heading', { name: 'Support workspace' }).waitFor()
      assert.notInclude(await current.locator('main').innerText(), 'customer-one@example.test')
      await current.goForward()
      await current.waitForURL('**/support')
      assert.include(await current.locator('main').innerText(), 'Customer Two')
    } finally {
      await secondContext.close()
    }
  })

  test('rejects an active customer A form after another tab switches the account to customer B', async ({
    browserContext,
    assert,
  }) => {
    const retained = await browserContext.newPage()
    await signIn(retained)
    await selectCustomer(retained, 1)
    await retained.getByRole('radio', { name: 'Can edit' }).check()
    await retained.getByLabel('Reason for support').fill('Customer A request')
    await retained.getByRole('button', { name: 'Start support mode' }).click()
    await retained.waitForURL('**/support/customer')
    await retained.getByRole('button', { name: 'Save preference' }).waitFor()

    const switcher = await browserContext.newPage()
    await switcher.goto(`${base()}/support`)
    await switcher.getByRole('button', { name: 'Stop support mode' }).click()
    await selectCustomer(switcher, 2)
    await switcher.getByRole('radio', { name: 'Can edit' }).check()
    await switcher.getByLabel('Reason for support').fill('Customer B request')
    await switcher.getByRole('button', { name: 'Start support mode' }).click()
    await switcher.waitForURL('**/support/customer')

    await retained.locator('form[action="/support/customer/preference"]').evaluate((form: any) => {
      form.requestSubmit()
    })
    await retained.waitForURL('**/support/recovery')
    await retained.getByRole('link', { name: 'Check current status' }).click()
    await retained.getByText(/viewing Customer Two/).waitFor()
    assert.notInclude(await retained.locator('main').innerText(), 'customer-one@example.test')
    assert.include(await retained.locator('main').innerText(), 'customer-two@example.test')
  })

  test('refreshes a visible workspace for customer A after another session switches to customer B', async ({
    browser,
    browserContext,
    assert,
  }) => {
    const workspace = await browserContext.newPage()
    await signIn(workspace)
    await selectCustomer(workspace, 1)
    await workspace.getByRole('radio', { name: 'Can edit' }).check()
    await workspace.getByLabel('Reason for support').fill('Customer A request')
    await workspace.getByRole('button', { name: 'Start support mode' }).click()
    await workspace.waitForURL('**/support/customer')
    await workspace.goto(`${base()}/support`)
    await workspace.getByText(/Viewing Customer One/).waitFor()

    const secondContext = await browser.newContext()
    try {
      const second = await secondContext.newPage()
      await signIn(second)
      await second.getByRole('button', { name: 'Stop support mode' }).click()
      await selectCustomer(second, 2)
      await second.getByRole('radio', { name: 'Can edit' }).check()
      await second.getByLabel('Reason for support').fill('Customer B request')
      await second.getByRole('button', { name: 'Start support mode' }).click()
      await second.waitForURL('**/support/customer')
    } finally {
      await secondContext.close()
    }

    await workspace.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
    await workspace.getByText(/Viewing Customer Two/).waitFor()
    assert.notInclude(await workspace.locator('main').innerText(), 'customer-one@example.test')
  })

  test('rechecks a captured customer A response after the account has switched to customer B', async ({
    browser,
    browserContext,
    assert,
  }) => {
    const first = await browserContext.newPage()
    await signIn(first)
    await selectCustomer(first, 1)
    await first.getByRole('radio', { name: 'Can edit' }).check()
    await first.getByLabel('Reason for support').fill('Customer A request')
    await first.getByRole('button', { name: 'Start support mode' }).click()
    await first.waitForURL('**/support/customer')
    await first.getByRole('link', { name: 'Return to operator workspace' }).click()
    await first.waitForURL('**/support')

    const delayed = await browserContext.newPage()
    let captureResponse!: (body: string) => void
    const capturedResponse = new Promise<string>((resolve) => {
      captureResponse = resolve
    })
    let releaseResponse!: () => void
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    await delayed.route(
      (url) => {
        const parsed = new URL(url)
        return (
          parsed.pathname === '/support/customer' && parsed.searchParams.get('delayMs') === '1200'
        )
      },
      async (route) => {
        const response = await route.fetch()
        const body = await response.text()
        captureResponse(body)
        await responseGate
        await route.fulfill({ response, body })
      }
    )
    const delayedVisit = delayed.goto(`${base()}/support/customer?delayMs=1200`)
    const capturedBody = await capturedResponse
    assert.include(capturedBody, 'customer-one@example.test')

    const switcher = await browserContext.newPage()
    await switcher.goto(`${base()}/support`)
    await switcher.getByRole('button', { name: 'Stop support mode' }).click()
    await selectCustomer(switcher, 2)
    await switcher.getByRole('radio', { name: 'Can edit' }).check()
    await switcher.getByLabel('Reason for support').fill('Customer B request')
    await switcher.getByRole('button', { name: 'Start support mode' }).click()
    await switcher.waitForURL('**/support/customer')

    releaseResponse()
    await delayedVisit
    await delayed.waitForURL('**/support')
    await delayed.getByText(/viewing Customer Two/).waitFor()
    assert.notInclude(await delayed.locator('main').innerText(), 'customer-one@example.test')
    assert.include(await delayed.locator('main').innerText(), 'customer-two@example.test')
    await switcher.goto(`${base()}/support`)
    await switcher.getByRole('button', { name: 'Stop support mode' }).click()

    const deadlineContext = await browser.newContext()
    const deadlinePage = await deadlineContext.newPage()
    const now = Date.now()
    mock.timers.enable({ apis: ['Date'], now })
    await deadlinePage.clock.install({ time: now })
    try {
      await signIn(deadlinePage)
      await selectCustomer(deadlinePage, 1)
      await deadlinePage.getByRole('radio', { name: 'Can edit' }).check()
      await deadlinePage.getByLabel('Reason for support').fill('Deadline check')
      await deadlinePage.getByRole('button', { name: 'Start support mode' }).click()
      await deadlinePage.waitForURL('**/support/customer')
      const deadline = Date.parse(
        (await deadlinePage.locator('time').first().getAttribute('datetime'))!
      )
      mock.timers.setTime(deadline + 1)
      await deadlinePage.clock.runFor(deadline - now + 1)
      await deadlinePage.waitForURL('**/support')
      assert.notInclude(await deadlinePage.locator('main').innerText(), 'customer-one@example.test')
      assert.equal(await deadlinePage.getByRole('button', { name: 'Save preference' }).count(), 0)
    } finally {
      mock.timers.reset()
      await deadlineContext.close()
    }
  })

  test('keeps an expired customer page hidden when its held identity response arrives late', async ({
    browser,
    assert,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const now = Date.now()
    mock.timers.enable({ apis: ['Date'], now })
    await page.clock.install({ time: now })

    let captureIdentity!: (body: string) => void
    const identityCaptured = new Promise<string>((resolve) => {
      captureIdentity = resolve
    })
    let releaseIdentity!: () => void
    const identityGate = new Promise<void>((resolve) => {
      releaseIdentity = resolve
    })
    let finishIdentity!: () => void
    const identityFinished = new Promise<void>((resolve) => {
      finishIdentity = resolve
    })

    let captureWorkspace!: () => void
    const workspaceCaptured = new Promise<void>((resolve) => {
      captureWorkspace = resolve
    })
    let releaseWorkspace!: () => void
    const workspaceGate = new Promise<void>((resolve) => {
      releaseWorkspace = resolve
    })

    await page.route('**/support/identity', async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      // The idle workspace checks status too; hold only the active customer page's check.
      if (!body.includes('"isMasquerading":true')) return route.fulfill({ response, body })
      captureIdentity(body)
      await identityGate
      await route.fulfill({ response, body })
      finishIdentity()
    })

    try {
      await signIn(page)
      await selectCustomer(page, 1)
      await page.getByRole('radio', { name: 'Can edit' }).check()
      await page.getByLabel('Reason for support').fill('Deadline race check')
      await page.getByRole('button', { name: 'Start support mode' }).click()
      await page.waitForURL('**/support/customer')
      await page.locator('[data-identity-pending]').waitFor()

      const identityBody = await identityCaptured
      assert.include(identityBody, '"isMasquerading":true')
      const expiryMatch = identityBody.match(/"expiresAt":"([^"]+)"/)
      assert.exists(expiryMatch)
      const deadline = Date.parse(expiryMatch![1])

      await page.route('**/support', async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const response = await route.fetch()
        captureWorkspace()
        await workspaceGate
        await route.fulfill({ response })
      })

      mock.timers.setTime(deadline + 1)
      await page.clock.runFor(deadline - now + 1)
      await workspaceCaptured

      releaseIdentity()
      await identityFinished
      await page.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      assert.equal(await page.locator('[data-identity="current"]').count(), 0)
      assert.notInclude(await page.locator('main').innerText(), 'customer-one@example.test')
      assert.equal(await page.getByRole('button', { name: 'Save preference' }).count(), 0)

      releaseWorkspace()
      await page.waitForURL('**/support')
      assert.notInclude(await page.locator('main').innerText(), 'customer-one@example.test')
      assert.equal(await page.getByRole('button', { name: 'Save preference' }).count(), 0)
    } finally {
      releaseIdentity()
      releaseWorkspace()
      mock.timers.reset()
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await context.close()
    }
  })

  test('renders raw stop and recovery when customer admission fails or storage is unavailable', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    await selectCustomer(page, 1)
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for support').fill('Recovery test')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    await page.locator('[data-identity="current"]').waitFor()
    const target = await User.findByOrFail('email', demoAccounts[1].email)
    target.active = false
    await target.save()
    await page.goto(`${base()}/support/customer`)
    await page.waitForURL('**/support/recovery')
    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.getByRole('button', { name: 'Start support mode' }).waitFor()
    assert.notInclude(await page.locator('main').innerText(), 'customer-one@example.test')

    target.active = true
    await target.save()
    await page.goto(`${base()}/support`)
    await selectCustomer(page, 1)
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for support').fill('Transient request failure')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    await page.locator('[data-identity="current"]').waitFor()
    setCustomerRequestsUnavailable(true)
    await page.goto(`${base()}/support/customer`)
    await page.waitForURL('**/support/recovery')
    assert.include(await page.locator('main').innerText(), 'may or may not have completed')
    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.getByRole('button', { name: 'Stop support mode' }).waitFor()
    assert.include(await page.locator('main').innerText(), 'Customer One')
    setCustomerRequestsUnavailable(false)
    await page.getByRole('button', { name: 'Stop support mode' }).click()
    await page.getByRole('button', { name: 'Start support mode' }).waitFor()
    await selectCustomer(page, 1)
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for support').fill('Store recovery test')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.waitForURL('**/support/customer')
    await page.locator('[data-identity="current"]').waitFor()

    setMasqueradeStoreUnavailable(true)
    await page.goto(`${base()}/support`)
    await page.waitForURL('**/support/recovery')
    await page.getByRole('heading', { name: 'Support action needs review' }).waitFor()
    assert.equal(await page.evaluate('document.activeElement?.tagName'), 'H1')
    setMasqueradeStoreUnavailable(false)
    await page.getByRole('link', { name: 'Check current status' }).click()
    await page.getByRole('button', { name: 'Stop support mode' }).waitFor()
  })
})

async function signIn(page: any) {
  await page.goto(`${base()}/login`)
  await page.getByLabel('Email').fill('operator@example.test')
  await page.getByLabel('Password').fill('demo-operator-2026')
  await page.getByRole('button', { name: 'Sign in' }).press('Enter')
  await page.waitForURL('**/support')
}

async function selectCustomer(page: any, index: number) {
  const customer = await User.findByOrFail('email', demoAccounts[index].email)
  await page.getByLabel('Customer').selectOption({ value: String(customer.id) })
}

function base() {
  const host = process.env.HOST ?? '127.0.0.1'
  const port = process.env.PORT ?? '3378'
  return `http://${host}:${port}`
}
