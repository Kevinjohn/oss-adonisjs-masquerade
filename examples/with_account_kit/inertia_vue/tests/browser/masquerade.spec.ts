import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { masqueradeOperatorEmails } from '#services/masquerade_operators'
import { setupAccountDatabase } from '../helpers/account_database.js'

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
    const customer = await User.create({ email: 'customer@example.test', password })

    const page = await visit('/login')
    await page.getByLabel('Email').fill('operator@example.test')
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('heading', { name: 'Your dashboard is ready' }).waitFor()

    await page.goto('/masquerade/accounts')
    await page.getByRole('button', { name: 'Act as customer@example.test' }).click()
    await page.getByRole('heading', { name: 'Your dashboard is ready' }).waitFor()
    const banner = page.getByRole('status').filter({ hasText: 'You are viewing as account' })
    await banner.getByText(`You are viewing as account ${customer.id}.`).waitFor()
    await banner.getByText('Access: View only.').waitFor()

    await banner.getByRole('button', { name: 'Stop masquerade' }).click()
    await page.getByText('Masquerade stopped.').waitFor()
    await page.goto('/dashboard')
    await page.getByRole('heading', { name: 'Your dashboard is ready' }).waitFor()
    await page.getByText('You are viewing as account').waitFor({ state: 'detached' })
    await page.goBack()
    await page.getByRole('heading', { name: 'Masquerade' }).waitFor()
    await page.getByText('You are acting as').waitFor({ state: 'detached' })
    await page.goForward()
    await page.getByText('You are viewing as account').waitFor({ state: 'detached' })

    await page.getByRole('button', { name: 'Log out' }).click()
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
    await page.goBack()
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
    await page.getByText('customer@example.test').waitFor({ state: 'detached' })
    await page.goForward()
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
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
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('heading', { name: 'Your dashboard is ready' }).waitFor()
    await page.goto('/masquerade/accounts')
    await page.getByRole('button', { name: 'Act as customer@example.test' }).waitFor()
    assert.equal(await page.getByRole('button', { name: /^Act as / }).count(), 50)
    await page.getByRole('button', { name: 'Act as customer@example.test' }).click()
    await page.getByRole('heading', { name: 'Your dashboard is ready' }).waitFor()
    assert.equal(
      await db.from('masquerade_modes').update({
        started_at: '2019-12-31T23:00:00.000Z',
        expires_at: '2020-01-01T00:00:00.000Z',
      }),
      1
    )

    await page.goto('/masquerade/accounts')
    await page.getByText('The persisted masquerade mode has expired.').waitFor()
    await page.getByRole('button', { name: 'Stop masquerade' }).waitFor()
    await page.getByRole('link', { name: 'Refresh status' }).waitFor()
    await page.getByRole('link', { name: 'Open their dashboard' }).waitFor({ state: 'detached' })
    await page.getByText('You are acting as').waitFor({ state: 'detached' })
  })
})
