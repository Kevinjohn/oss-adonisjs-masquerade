import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import User from '#models/user'
import { masqueradeOperatorEmails } from '#services/masquerade_operators'
import { setupAccountDatabase } from '../helpers/account_database.js'
import { InertiaSession } from '../helpers/inertia_session.js'

const password = 'MasqueradePass123!'

type AccountsProps = {
  canMasquerade: boolean
  mode: { isMasquerading: boolean; contextToken: string }
  accounts: { id: number; email: string }[]
  outcome: { type: string; message: string } | null
}
type AppProps = {
  user?: { email: string }
  masquerade?: { isMasquerading: boolean; targetId: string }
}

async function createAccounts() {
  masqueradeOperatorEmails.add('operator@example.test')
  masqueradeOperatorEmails.add('second-operator@example.test')
  return {
    operator: await User.create({ email: 'operator@example.test', password }),
    // A changed password gives the customer a credential revision the operator's session lacks.
    customer: await User.create({
      email: 'customer@example.test',
      password,
      credentialsChangedAt: DateTime.now().minus({ days: 1 }),
    }),
    secondOperator: await User.create({ email: 'second-operator@example.test', password }),
  }
}

/** Opens the operator page and submits its start form for one account. */
async function start(session: InertiaSession, target: User) {
  const page = await session.props<AccountsProps>('/masquerade/accounts')
  return session.request('/masquerade/start', {
    _masqueradeContext: page.mode.contextToken,
    targetId: String(target.id),
    access: 'view',
  })
}

test.group('masquerade', (group) => {
  group.each.setup(async () => {
    const cleanup = await setupAccountDatabase()
    await limiter.clear(['memory'])
    return async () => {
      masqueradeOperatorEmails.clear()
      await cleanup()
    }
  })

  test('an operator acts as a customer, cannot change their password, then stops', async ({
    assert,
  }) => {
    const { operator, customer } = await createAccounts()
    const operatorPasswordHash = operator.password
    const customerPasswordHash = customer.password
    const session = new InertiaSession()
    await session.login(operator.email, password)

    const started = await start(session, customer)
    assert.equal(started.headers.get('location'), '/dashboard')
    const acting = await session.props<AppProps>('/dashboard')
    assert.equal(acting.user?.email, 'customer@example.test')
    assert.deepInclude(acting.masquerade, { isMasquerading: true, targetId: String(customer.id) })

    const refused = await session.request('/settings/password', {
      currentPassword: password,
      password: 'ChangedPass123!',
      passwordConfirmation: 'ChangedPass123!',
    })
    assert.equal(refused.status, 403)
    assert.deepEqual(await refused.json(), {
      errors: [
        {
          code: 'E_MASQUERADE_ACTION_BLOCKED',
          message: 'Action is blocked while masquerading',
          blockedBy: 'sensitive',
        },
      ],
    })
    // Authenticated proof flows must not bypass the same raw-account blocker.
    const proof = await session.request('/reset-password/unused-token')
    assert.equal(proof.status, 403)
    assert.deepInclude((await proof.json()) as object, {
      errors: [
        {
          code: 'E_MASQUERADE_ACTION_BLOCKED',
          message: 'Action is blocked while masquerading',
          blockedBy: 'sensitive',
        },
      ],
    })
    const stored = await User.findOrFail(customer.id)
    const storedOperator = await User.findOrFail(operator.id)
    assert.equal(stored.password, customerPasswordHash)
    assert.equal(storedOperator.password, operatorPasswordHash)

    const page = await session.props<AccountsProps>('/masquerade/accounts')
    const stopped = await session.request('/masquerade/stop', {
      _masqueradeContext: page.mode.contextToken,
    })
    assert.equal(stopped.headers.get('location'), '/masquerade/accounts')
    const restored = await session.props<AppProps>('/dashboard')
    assert.equal(restored.user?.email, 'operator@example.test')
    assert.isFalse(restored.masquerade?.isMasquerading)
  })

  test('an account can change its password while idle', async ({ assert }) => {
    const { operator } = await createAccounts()
    const session = new InertiaSession()
    await session.login(operator.email, password)

    const changed = await session.request('/settings/password', {
      currentPassword: password,
      password: 'ChangedPass123!',
      passwordConfirmation: 'ChangedPass123!',
    })
    assert.equal(changed.headers.get('location'), '/settings/password')
    const stored = await User.findOrFail(operator.id)
    assert.notEqual(stored.password, operator.password)
  })

  test('an operator can log out while masquerading', async ({ assert }) => {
    const { operator, customer } = await createAccounts()
    const session = new InertiaSession()
    await session.login(operator.email, password)
    await start(session, customer)

    const loggedOut = await session.request('/logout', {})
    assert.equal(loggedOut.headers.get('location'), '/login')
    const after = await session.request('/dashboard')
    assert.equal(after.headers.get('location'), '/login')
  })

  test('an account that is not an operator cannot start', async ({ assert }) => {
    const { customer, operator } = await createAccounts()
    const session = new InertiaSession()
    await session.login(customer.email, password)

    const page = await session.props<AccountsProps>('/masquerade/accounts')
    assert.isFalse(page.canMasquerade)
    const refused = await session.request('/masquerade/start', {
      _masqueradeContext: page.mode.contextToken,
      targetId: String(operator.id),
    })
    assert.equal(refused.headers.get('location'), '/masquerade/accounts')
    const after = await session.props<AccountsProps>('/masquerade/accounts')
    assert.deepEqual(after.outcome, { type: 'error', message: 'You cannot act as that account.' })
    assert.lengthOf(await db.from('masquerade_modes').where('state', 'active'), 0)
    const dashboard = await session.props<AppProps>('/dashboard')
    assert.equal(dashboard.user?.email, customer.email)
  })

  test('an operator cannot act as another operator', async ({ assert }) => {
    const { operator, secondOperator } = await createAccounts()
    const session = new InertiaSession()
    await session.login(operator.email, password)

    const page = await session.props<AccountsProps>('/masquerade/accounts')
    assert.notInclude(
      page.accounts.map((account) => account.email),
      secondOperator.email
    )
    await start(session, secondOperator)
    const after = await session.props<AccountsProps>('/masquerade/accounts')
    assert.deepEqual(after.outcome, { type: 'error', message: 'You cannot act as that account.' })
    const dashboard = await session.props<AppProps>('/dashboard')
    assert.equal(dashboard.user?.email, operator.email)
  })
})
