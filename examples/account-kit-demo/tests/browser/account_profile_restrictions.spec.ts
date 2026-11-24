import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
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
  type BrowserPage,
} from './demo_browser_fixture.js'

const screenshots = resolve('tmp/browser')
const operator = demoAccounts[0]
const customer = demoAccounts[1]

test.group('Account Kit profile write restrictions browser journey', (group) => {
  let before: DemoBrowserState | undefined
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    before = undefined
    await seedDemoBrowserAccounts()
    before = await captureDemoBrowserState()
  })
  group.each.teardown(async () => restoreDemoBrowserState(before))

  test('saves while idle, shows the active-mode denial on mobile, then retries after stop', async ({
    browser,
    assert,
  }) => {
    await mkdir(screenshots, { recursive: true })
    const { context, page } = await newDemoPage(browser)
    try {
      await signInKeyboard(page)
      const originalActor = await db.from('users').where('id', before!.operatorId).first()
      const customerRow = await db.from('users').where('email', customer.email).first()
      const originalCustomer = await db.from('users').where('id', customerRow.id).first()

      await page.goto(`${baseUrl()}/support/account`)
      const idleReload = page.waitForNavigation()
      const idleResult = await enterProfileWithKeyboard(
        page,
        'Idle Profile Operator',
        operator.password
      )
      assert.equal(idleResult.status, 200)
      await idleReload
      const idleActor = await db.from('users').where('id', before!.operatorId).first()
      assert.equal(idleActor.full_name, 'Idle Profile Operator')
      assertAccountRowChangedOnlyByProfile(assert, originalActor, idleActor)
      assert.deepEqual(await db.from('users').where('id', customerRow.id).first(), originalCustomer)
      await page.waitForLoadState('domcontentloaded')
      assert.equal(await page.getByLabel('Display name').inputValue(), 'Idle Profile Operator')

      await startModeWithKeyboard(page, customer.email)
      await page.goto(`${baseUrl()}/support/account`)
      await page.setViewportSize({ width: 375, height: 812 })
      const blocked = await enterProfileWithKeyboard(
        page,
        'Blocked Profile Operator',
        operator.password
      )
      assert.equal(blocked.status, 403)
      assert.equal(blocked.issue.code, 'E_MASQUERADE_SENSITIVE_ACTION_BLOCKED')
      await waitForProfileErrorUi(page)
      assert.equal(await page.getByRole('alert').isVisible(), true)
      const blockedAlert = await page.getByRole('alert').innerText()
      assert.equal(blockedAlert.trim(), blocked.issue.message ?? blocked.issue.title)
      assert.equal(await page.getByLabel('Display name').inputValue(), 'Blocked Profile Operator')
      assert.equal(await page.getByLabel('Current password').inputValue(), '')
      const stopLink = page.getByRole('link', { name: /stop support mode/i })
      assert.equal(await stopLink.isVisible(), true)
      assert.equal(
        await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
        true
      )
      assert.equal(await page.getByLabel('Display name').isVisible(), true)
      assert.equal(await page.getByLabel('Current password').isVisible(), true)
      assert.equal(await page.getByRole('button', { name: 'Save display name' }).isVisible(), true)
      assert.deepEqual(await db.from('users').where('id', before!.operatorId).first(), idleActor)
      assert.deepEqual(await db.from('users').where('id', customerRow.id).first(), originalCustomer)
      await page.screenshot({
        path: resolve(screenshots, 'account_kit_profile_blocked_mobile.png'),
      })

      await stopLink.focus()
      await page.keyboard.press('Enter')
      await page.waitForURL('**/support')
      const stop = page.getByRole('button', { name: 'Stop support mode' })
      await stop.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { name: 'Choose a customer' }).waitFor()

      await page.goto(`${baseUrl()}/support/account`)
      const recoveredReload = page.waitForNavigation()
      const recovered = await enterProfileWithKeyboard(
        page,
        'Recovered Profile Operator',
        operator.password
      )
      assert.equal(recovered.status, 200)
      await recoveredReload
      const finalActor = await db.from('users').where('id', before!.operatorId).first()
      assert.equal(finalActor.full_name, 'Recovered Profile Operator')
      assertAccountRowChangedOnlyByProfile(assert, originalActor, finalActor)
      assert.deepEqual(await db.from('users').where('id', customerRow.id).first(), originalCustomer)
      await page.reload()
      assert.equal(await page.getByLabel('Display name').inputValue(), 'Recovered Profile Operator')
    } finally {
      await context.close()
    }
  })

  test('keeps wrong-password and invalid-name feedback visible and retryable', async ({
    browser,
    assert,
  }) => {
    const { context, page } = await newDemoPage(browser)
    try {
      await signInKeyboard(page)
      const originalActor = await db.from('users').where('id', before!.operatorId).first()
      const customerRow = await db.from('users').where('email', customer.email).first()
      const originalCustomer = await db.from('users').where('id', customerRow.id).first()
      await page.goto(`${baseUrl()}/support/account`)

      const wrongPassword = await enterProfileWithKeyboard(
        page,
        'Retry Wrong Password',
        'incorrect-password'
      )
      assert.equal(wrongPassword.status, 403)
      assert.equal(wrongPassword.issue.code, 'E_ACCOUNT_KIT_IDENTITY_NOT_CONFIRMED')
      await waitForProfileErrorUi(page)
      assert.equal(await page.getByRole('alert').isVisible(), true)
      assert.equal(await page.getByLabel('Display name').inputValue(), 'Retry Wrong Password')
      assert.equal(await page.getByLabel('Current password').inputValue(), '')
      assert.equal(await page.locator('[data-kit-stop]').isHidden(), true)
      assert.deepEqual(
        await db.from('users').where('id', before!.operatorId).first(),
        originalActor
      )

      const invalidName = await enterProfileWithKeyboard(page, '   ', operator.password)
      assert.equal(invalidName.status, 422)
      await waitForProfileErrorUi(page)
      assert.equal(await page.getByRole('alert').isVisible(), true)
      const invalidNameAlert = await page.getByRole('alert').innerText()
      assert.isNotEmpty(invalidNameAlert.trim())
      assert.equal(await page.getByLabel('Display name').inputValue(), '   ')
      assert.equal(await page.getByLabel('Current password').inputValue(), '')
      assert.equal(await page.locator('[data-kit-stop]').isHidden(), true)
      assert.deepEqual(
        await db.from('users').where('id', before!.operatorId).first(),
        originalActor
      )
      assert.deepEqual(await db.from('users').where('id', customerRow.id).first(), originalCustomer)

      const successfulReload = page.waitForNavigation()
      const successful = await enterProfileWithKeyboard(
        page,
        'Retry Successful Update',
        operator.password
      )
      assert.equal(successful.status, 200)
      await successfulReload
      const finalActor = await db.from('users').where('id', before!.operatorId).first()
      assert.equal(finalActor.full_name, 'Retry Successful Update')
      assertAccountRowChangedOnlyByProfile(assert, originalActor, finalActor)
      assert.deepEqual(await db.from('users').where('id', customerRow.id).first(), originalCustomer)
    } finally {
      await context.close()
    }
  })
})

async function signInKeyboard(page: BrowserPage) {
  await page.goto(`${baseUrl()}/login`)
  await page.getByLabel('Email').focus()
  await page.keyboard.type(operator.email)
  await page.keyboard.press('Tab')
  await page.keyboard.type(operator.password)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/support')
}

async function startModeWithKeyboard(page: BrowserPage, email: string) {
  await page.goto(`${baseUrl()}/support`)
  const start = page.getByRole('button', { name: 'Start support mode' })
  await start.focus()
  await page.keyboard.press('Enter')
  const customerSelect = page.getByLabel('Customer', { exact: true })
  await customerSelect.focus()
  await page.keyboard.press('c')
  const selectedUser = await db.from('users').where('email', email).first()
  if (email !== customer.email)
    throw new Error('The keyboard profile scenario expects customer one.')
  if ((await customerSelect.inputValue()) !== String(selectedUser.id))
    throw new Error('Keyboard customer selection did not select the reserved customer.')
  await page.getByLabel('Reason for access').focus()
  await page.keyboard.type('Review a display-name request')
  const edit = page.getByRole('radio', { name: 'Can edit' })
  await edit.focus()
  await page.keyboard.press('Space')
  await start.focus()
  await page.keyboard.press('Enter')
  await page.waitForURL('**/support/customer')
}

async function enterProfileWithKeyboard(
  page: BrowserPage,
  fullName: string,
  password: string
): Promise<Awaited<ReturnType<typeof waitForProfileResponse>>> {
  const name = page.getByLabel('Display name')
  await name.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(fullName)
  await page.keyboard.press('Tab')
  await page.keyboard.type(password)
  await page.keyboard.press('Tab')
  const response = waitForProfileResponse(page)
  await page.keyboard.press('Enter')
  return response
}

async function waitForProfileErrorUi(page: BrowserPage) {
  await page.locator('[data-kit-profile] [data-kit-error]').waitFor({ state: 'visible' })
  await page
    .locator('[data-kit-profile] button[type="submit"]:not([disabled])')
    .waitFor({ state: 'visible' })
}

async function waitForProfileResponse(page: BrowserPage) {
  const response = await page.waitForResponse(
    (candidate) => new URL(candidate.url()).pathname === '/kit/account/profile'
  )
  const body = (await response.json().catch(() => ({}))) as {
    errors?: { code?: string; title?: string; message?: string }[]
  }
  const issue = body.errors?.[0] ?? {}
  return {
    status: response.status(),
    issue,
  }
}

function assertAccountRowChangedOnlyByProfile(
  assert: { deepEqual(actual: unknown, expected: unknown, message?: string): unknown },
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  for (const column of Object.keys(before)) {
    if (column === 'full_name' || column === 'updated_at') continue
    assert.deepEqual(after[column], before[column], column)
  }
}
