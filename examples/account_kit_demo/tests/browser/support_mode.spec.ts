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
  type BrowserPage,
  type DemoBrowserState,
} from './demo_browser_fixture.js'

const screenshots = resolve('tmp/browser')
const operator = demoAccounts[0]
const customerAccount = demoAccounts[1]

async function togglePreferenceWithKeyboard(page: BrowserPage, originalValue: string) {
  const preference = page.getByLabel('Setting', { exact: true })
  await preference.focus()
  await page.keyboard.press('o')
  const changedValue = await preference.inputValue()
  if (changedValue === originalValue)
    throw new Error('The native preference select did not change after keyboard option navigation.')
  return changedValue
}

test.group('Account Kit support mode browser journey', (group) => {
  let before: DemoBrowserState | undefined
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    before = undefined
    await seedDemoBrowserAccounts()
    before = await captureDemoBrowserState()
  })
  group.each.teardown(async () => restoreDemoBrowserState(before))

  test('uses keyboard controls for view rejection, edit persistence, reversal, and stop', async ({
    browser,
    assert,
  }) => {
    await mkdir(screenshots, { recursive: true })
    const { context, page } = await newDemoPage(browser)
    try {
      await page.goto(`${baseUrl()}/login`)
      await page.getByLabel('Email').focus()
      await page.keyboard.type(operator.email)
      await page.keyboard.press('Tab')
      await page.keyboard.type(operator.password)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.waitForURL('**/support')

      const start = page.getByRole('button', { name: 'Start support mode' })
      await start.focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.evaluate('document.activeElement.id'), 'targetId')

      const customer = page.getByLabel('Customer', { exact: true })
      await customer.focus()
      await page.keyboard.press('c')
      const customerRow = await db.from('users').where('email', customerAccount.email).first()
      assert.equal(await customer.inputValue(), String(customerRow.id))
      await page.getByLabel('Reason for access').focus()
      await page.keyboard.type('Read a customer preference request')
      await start.focus()
      await page.keyboard.press('Enter')
      await page.waitForURL('**/support/customer')
      assert.include(await page.locator('[data-support-mode]').innerText(), 'View only')
      assert.include(await page.locator('[data-support-mode]').innerText(), operator.fullName)
      assert.include(await page.locator('body').innerText(), customerAccount.email)

      const preferenceBefore = await db
        .from('demo_preferences')
        .where('user_id', customerRow.id)
        .first()
      const originalValue = preferenceBefore?.email_updates ? '1' : '0'
      assert.notEqual(await togglePreferenceWithKeyboard(page, originalValue), originalValue)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { name: 'View-only support mode' }).waitFor()
      assert.deepEqual(
        await db.from('demo_preferences').where('user_id', customerRow.id).first(),
        preferenceBefore
      )

      await page.goto(`${baseUrl()}/support`)
      const stop = page.getByRole('button', { name: 'Stop support mode' })
      await stop.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { name: 'Choose a customer' }).waitFor()
      let stoppedMode = await db
        .from('masquerade_modes')
        .where('actor_id', String(before!.operatorId))
        .first()
      assert.equal(stoppedMode?.state, 'idle')
      assert.isNull(stoppedMode?.target_id)

      const editStart = page.getByRole('button', { name: 'Start support mode' })
      const editCustomer = page.getByLabel('Customer', { exact: true })
      await editCustomer.focus()
      await page.keyboard.press('c')
      await page.getByLabel('Reason for access').focus()
      await page.keyboard.type('Reverse the customer preference change')
      const editRadio = page.getByRole('radio', { name: 'Can edit' })
      await editRadio.focus()
      await page.keyboard.press('Space')
      assert.equal(await editRadio.isChecked(), true)
      await editStart.focus()
      await page.keyboard.press('Enter')
      await page.waitForURL('**/support/customer')
      assert.include(await page.locator('[data-support-mode]').innerText(), 'Can edit')

      const changedValue = await togglePreferenceWithKeyboard(page, originalValue)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.getByText('Customer email preference saved.').waitFor()
      let saved = await db.from('demo_preferences').where('user_id', customerRow.id).first()
      assert.equal(String(Number(saved?.email_updates)), changedValue)
      await page.reload()
      assert.equal(await page.getByLabel('Setting', { exact: true }).inputValue(), changedValue)
      await page.screenshot({ path: resolve(screenshots, 'account_kit_support_preference.png') })

      const restoredValue = await togglePreferenceWithKeyboard(page, changedValue)
      assert.equal(restoredValue, originalValue)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.getByText('Customer email preference saved.').waitFor()
      saved = await db.from('demo_preferences').where('user_id', customerRow.id).first()
      assert.equal(String(Number(saved?.email_updates)), originalValue)

      await page.goto(`${baseUrl()}/support`)
      const finalStop = page.getByRole('button', { name: 'Stop support mode' })
      await finalStop.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { name: 'Choose a customer' }).waitFor()
      stoppedMode = await db
        .from('masquerade_modes')
        .where('actor_id', String(before!.operatorId))
        .first()
      assert.equal(stoppedMode?.state, 'idle')
      assert.isNull(stoppedMode?.target_id)
    } finally {
      await context.close()
    }
  })
})
