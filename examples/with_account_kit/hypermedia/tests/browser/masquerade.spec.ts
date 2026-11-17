import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { masqueradeOperatorEmails } from '#services/masquerade_operators'
import { setupAccountDatabase } from '#tests/helpers/account_database'

const password = 'MasqueradePass123!'

test.group('masquerade in the browser', (group) => {
  group.each.setup(async () => {
    const cleanup = await setupAccountDatabase()
    await limiter.clear(['memory'])
    return async () => {
      masqueradeOperatorEmails.clear()
      await cleanup()
    }
  })

  test('an operator starts, sees the banner, and stops', async ({ visit }) => {
    masqueradeOperatorEmails.add('operator@example.test')
    await User.create({ email: 'operator@example.test', password })
    await User.create({ email: 'customer@example.test', password })

    const page = await visit('/login')
    await page.getByLabel('Email').fill('operator@example.test')
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('heading', { name: 'Your account' }).waitFor()

    await page.goto('/masquerade/accounts')
    await page.getByRole('button', { name: 'Act as customer@example.test' }).click()
    await page.getByText('Signed in as customer@example.test.').waitFor()
    const banner = page.getByRole('status').filter({ hasText: 'You are viewing as account' })
    await banner.getByText('Access: View only.').waitFor()

    await banner.getByRole('button', { name: 'Stop masquerade' }).click()
    await page.getByText('Masquerade stopped.').waitFor()
    await page.goto('/dashboard')
    await page.getByText('Signed in as operator@example.test.').waitFor()
    await page.getByText('You are viewing as account').waitFor({ state: 'detached' })
  })

  test('an expired persisted mode offers recovery without acting-as controls', async ({
    visit,
    assert,
  }) => {
    masqueradeOperatorEmails.add('operator@example.test')
    await User.create({ email: 'operator@example.test', password })
    await User.create({ email: 'customer@example.test', password })
    await User.createMany(
      Array.from({ length: 55 }, (_, index) => ({ email: `zz${index}@example.test`, password }))
    )
    const page = await visit('/login')
    await page.getByLabel('Email').fill('operator@example.test')
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('heading', { name: 'Your account' }).waitFor()
    await page.goto('/masquerade/accounts')
    await page.getByRole('button', { name: 'Act as customer@example.test' }).waitFor()
    assert.equal(await page.getByRole('button', { name: /^Act as / }).count(), 50)
    await page.getByText('Showing up to 50 accounts, ordered by email.').waitFor()
    const displayed = await page.getByRole('button', { name: /^Act as / }).allTextContents()
    const expected = [
      'customer@example.test',
      ...Array.from({ length: 55 }, (_, index) => `zz${index}@example.test`),
    ]
      .sort()
      .slice(0, 50)
      .map((email) => `Act as ${email}`)
    assert.deepEqual(
      displayed.map((text) => text.trim()),
      expected
    )
    await page.getByRole('button', { name: 'Act as customer@example.test' }).click()
    await page.getByText('Signed in as customer@example.test.').waitFor()
    assert.equal(
      await db.from('masquerade_modes').update({
        started_at: '2019-12-31T23:00:00.000Z',
        expires_at: '2020-01-01T00:00:00.000Z',
      }),
      1
    )

    await page.goto('/masquerade/accounts')
    await page.getByText('The persisted masquerade mode has expired for this page.').waitFor()
    await page.getByRole('button', { name: 'Stop masquerade' }).waitFor()
    await page.getByRole('link', { name: 'Refresh status' }).waitFor()
    await page.getByRole('link', { name: 'Open their dashboard' }).waitFor({ state: 'hidden' })
    await page.getByText('You are acting as').waitFor({ state: 'hidden' })
  })

  test('a restored workspace updates at its deadline and keeps the stop action', async ({
    visit,
    assert,
  }) => {
    masqueradeOperatorEmails.add('operator@example.test')
    await User.create({ email: 'operator@example.test', password })
    await User.create({ email: 'customer@example.test', password })

    const page = await visit('/login')
    await page.getByLabel('Email').fill('operator@example.test')
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('heading', { name: 'Your account' }).waitFor()
    await page.goto('/masquerade/accounts')
    await page.getByRole('button', { name: 'Act as customer@example.test' }).click()
    await page.getByText('Signed in as customer@example.test.').waitFor()

    await page.goto('/masquerade/accounts')
    await page.getByText('You are acting as').waitFor()
    const deadline = Date.parse(
      (await page.locator('[data-masquerade-deadline]').getAttribute('data-masquerade-deadline'))!
    )
    await page.clock.install({ time: deadline - 3_000 })
    await page.reload()
    await page.getByText('You are acting as').waitFor()
    await page.evaluate(() => {
      const status = document.querySelector<HTMLElement>(
        '[data-masquerade-expired][role="status"]'
      )!
      status.dataset.expiryUpdates = '0'
      new MutationObserver(() => {
        status.dataset.expiryUpdates = String(Number(status.dataset.expiryUpdates) + 1)
      }).observe(status, { attributes: true, attributeFilter: ['hidden'] })
    })

    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    )
    await page.clock.runFor(1_000)
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    )
    await page.getByText('You are acting as').waitFor()
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible')

    await page.clock.runFor(2_001)
    await page.getByText('The persisted masquerade mode has expired for this page.').waitFor()
    assert.equal(
      await page
        .locator('[data-masquerade-expired][role="status"]')
        .getAttribute('data-expiry-updates'),
      '1'
    )
    await page.getByRole('button', { name: 'Stop masquerade' }).waitFor()
    await page.getByRole('link', { name: 'Open their dashboard' }).waitFor({ state: 'hidden' })

    await page.clock.setFixedTime(deadline - 2_000)
    await page.reload()
    await page.getByText('You are acting as').waitFor()
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    )
    await page.clock.setFixedTime(deadline + 1)
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    )
    await page.getByText('The persisted masquerade mode has expired for this page.').waitFor()
    await page.getByRole('button', { name: 'Stop masquerade' }).waitFor()
    await page.getByRole('link', { name: 'Open their dashboard' }).waitFor({ state: 'hidden' })
  })
})
