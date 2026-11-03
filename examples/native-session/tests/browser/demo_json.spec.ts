import { test } from '@japa/runner'
import type { TestContext } from '@japa/runner/core'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { demoAccounts, resetDemoAccounts, seedDemoAccounts } from '#services/demo_accounts'
import {
  setMasqueradeStoreUnavailable,
  setMasqueradeTestTime,
} from '#services/masquerade_fixture_boundary'

type Page = Awaited<ReturnType<TestContext['browserContext']['newPage']>>
const base = () => `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '3391'}`

test.group('JSON support browser client', (group) => {
  group.setup(() => testUtils.db().migrate())
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

  test('uses JSON controls and effective customer routes to persist and reverse a preference', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    await page.goto(`${base()}/support/json`)
    await page.getByText('Support mode is idle.').waitFor()
    await page
      .getByLabel('Customer')
      .selectOption({ label: 'Customer One — customer-one@example.test' })
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for access').fill('Customer requested email setting help')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.getByText('Action completed.').waitFor()
    const customer = await User.findByOrFail('email', demoAccounts[1].email)
    assert.include(await page.locator('#json-customer').innerText(), customer.email)
    assert.include(await page.locator('#json-customer').innerText(), demoAccounts[0].email)
    await page.getByLabel('Email updates').selectOption('1')
    const rejectedCsrf = await page.evaluate(async () => {
      const statusResponse = await fetch('/masquerade', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const status = (await statusResponse.json()) as { contextToken: string }
      const response = await fetch('/support/json/customer/preference', {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'manual',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Masquerade-Context': status.contextToken,
        },
        body: JSON.stringify({ emailUpdates: '1' }),
      })
      return {
        status: response.status,
        responseType: response.type,
        contentType: response.headers.get('content-type') || '',
      }
    })
    assert.isTrue(
      (rejectedCsrf.responseType === 'opaqueredirect' && rejectedCsrf.status === 0) ||
        rejectedCsrf.status === 403
    )
    assert.notInclude(rejectedCsrf.contentType, 'application/json')
    assert.isNull(await db.from('demo_preferences').where('user_id', customer.id).first())
    await page.getByRole('button', { name: 'Save preference' }).click()
    await page.getByText('Action completed.').waitFor()
    let saved = await db.from('demo_preferences').where('user_id', customer.id).first()
    assert.equal(saved?.email_updates, 1)
    await page.getByRole('button', { name: 'Try sensitive action' }).click()
    await page.getByText('This action is blocked').waitFor()
    saved = await db.from('demo_preferences').where('user_id', customer.id).first()
    assert.equal(saved?.email_updates, 1)
    await page.getByRole('button', { name: 'Stop support mode' }).click()
    await page.getByText('No support mode is active.').waitFor()
    assert.equal(await page.locator('#json-preference').isHidden(), true)
  })

  test('discards customer A state after another tab stops and starts customer B', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    await page.goto(`${base()}/support/json`)
    await page.getByText('Support mode is idle.').waitFor()
    await page
      .getByLabel('Customer')
      .selectOption({ label: 'Customer One — customer-one@example.test' })
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for access').fill('First customer')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.getByText('Action completed.').waitFor()
    let releaseOld!: () => void
    let capturedOld!: () => void
    let deliveredOld!: () => void
    const oldHeld = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    const oldCaptured = new Promise<void>((resolve) => {
      capturedOld = resolve
    })
    const oldDelivered = new Promise<void>((resolve) => {
      deliveredOld = resolve
    })
    let delayed = false
    await page.route('**/support/json/customer', async (route) => {
      if (delayed) return route.continue()
      delayed = true
      const response = await route.fetch()
      capturedOld()
      await oldHeld
      await route.fulfill({ response })
      deliveredOld()
    })
    await page.getByRole('button', { name: 'Check current status' }).click()
    await oldCaptured
    const other = await browserContext.newPage()
    await other.goto(`${base()}/support/json`)
    await other.getByText('Customer access confirmed.').waitFor()
    await other.getByRole('button', { name: 'Stop support mode' }).click()
    await other.getByText('No support mode is active.').waitFor()
    await other
      .getByLabel('Customer')
      .selectOption({ label: 'Customer Two — customer-two@example.test' })
    await other.getByRole('radio', { name: 'Can edit' }).check()
    await other.getByLabel('Reason for access').fill('Second customer')
    await other.getByRole('button', { name: 'Start support mode' }).click()
    await other.getByText('Action completed.').waitFor()
    await page.getByRole('button', { name: 'Check current status' }).click()
    await page.getByText('Customer access confirmed.').waitFor()
    assert.include(await page.locator('#json-customer').innerText(), demoAccounts[2].email)
    releaseOld()
    await oldDelivered
    assert.notInclude(await page.locator('#json-customer').innerText(), demoAccounts[1].email)
    assert.equal(await page.getByLabel('Email updates').inputValue(), '0')
  })

  test('freezes at exact expiry and recovers through raw status when effective admission fails', async ({
    browserContext,
    assert,
  }) => {
    const fixed = Date.now()
    setMasqueradeTestTime(fixed)
    const page = await browserContext.newPage()
    await page.clock.install({ time: fixed })
    await signIn(page)
    await page.goto(`${base()}/support/json`)
    await page.getByText('Support mode is idle.').waitFor()
    await page
      .getByLabel('Customer')
      .selectOption({ label: 'Customer One — customer-one@example.test' })
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for access').fill('Expiry and recovery')
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.getByText('Action completed.').waitFor()
    const deadlineText = await page.locator('#json-deadline').innerText()
    const deadline = Date.parse(deadlineText.replace('Fixed deadline: ', ''))
    await page.clock.setFixedTime(deadline)
    await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    await page.locator('#json-preference').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#json-preference').isHidden(), true)
    assert.equal(
      await page.getByRole('button', { name: 'Try sensitive action' }).isDisabled(),
      true
    )
    assert.equal(await page.getByRole('button', { name: 'Stop support mode' }).isEnabled(), true)
    setMasqueradeTestTime(deadline)
    await page.getByRole('button', { name: 'Stop support mode' }).click()
    await page.getByText('No support mode is active.').waitFor()
    setMasqueradeTestTime(undefined)
  })

  test('recovers from an unavailable control outcome without replaying the start', async ({
    browserContext,
    assert,
  }) => {
    const page = await browserContext.newPage()
    await signIn(page)
    await page.goto(`${base()}/support/json`)
    await page.getByText('Support mode is idle.').waitFor()
    await page
      .getByLabel('Customer')
      .selectOption({ label: 'Customer One — customer-one@example.test' })
    await page.getByRole('radio', { name: 'Can edit' }).check()
    await page.getByLabel('Reason for access').fill('Unavailable control recovery')
    setMasqueradeStoreUnavailable(true)
    await page.getByRole('button', { name: 'Start support mode' }).click()
    await page.getByText('may have completed', { exact: false }).waitFor()
    assert.equal(await page.getByLabel('Customer').inputValue(), '')
    assert.equal(await page.getByLabel('Reason for access').inputValue(), '')
    setMasqueradeStoreUnavailable(false)
    await page.getByRole('button', { name: 'Check current status' }).click()
    await page.getByText('Support mode is idle.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Start support mode' }).isVisible(), true)
  })
})

async function signIn(page: Page) {
  await page.goto(`${base()}/login`)
  await page.getByLabel('Email').fill(demoAccounts[0].email)
  await page.getByLabel('Password').fill(demoAccounts[0].password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard')
}
