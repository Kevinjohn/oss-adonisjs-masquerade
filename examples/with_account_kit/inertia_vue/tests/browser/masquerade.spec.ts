import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
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
  })
})
