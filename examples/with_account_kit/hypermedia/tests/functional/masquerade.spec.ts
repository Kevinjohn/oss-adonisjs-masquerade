import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import User from '#models/user'
import { masqueradeOperatorEmails } from '#services/masquerade_operators'
import { setupAccountDatabase } from '#tests/helpers/account_database'
import { FormSession } from '#tests/helpers/form_session'

const password = 'MasqueradePass123!'

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
async function start(session: FormSession, target: User, access: 'view' | 'edit' = 'view') {
  await session.request('/masquerade/accounts')
  return session.request('/masquerade/start', {
    _masqueradeContext: session.field('_masqueradeContext') ?? '',
    targetId: String(target.id),
    access,
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
    const session = new FormSession()
    await session.login(operator.email, password)

    const started = await start(session, customer)
    assert.equal(started.headers.get('location'), '/dashboard')
    await session.request('/dashboard')
    assert.include(session.html, 'Signed in as <strong>customer@example.test</strong>')
    assert.include(session.html, `You are viewing as account ${customer.id}.`)

    await session.request('/settings/password')
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

    await session.request('/masquerade/accounts')
    const stopped = await session.request('/masquerade/stop', {
      _masqueradeContext: session.field('_masqueradeContext') ?? '',
    })
    assert.equal(stopped.headers.get('location'), '/masquerade/accounts')
    await session.request('/dashboard')
    assert.include(session.html, 'Signed in as <strong>operator@example.test</strong>')
    assert.notInclude(session.html, 'You are viewing as account')
  })

  test('an account can change its password while idle', async ({ assert }) => {
    const { operator } = await createAccounts()
    const session = new FormSession()
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
    const session = new FormSession()
    await session.login(operator.email, password)
    await start(session, customer)

    await session.request('/dashboard')
    const loggedOut = await session.request('/logout', {})
    assert.equal(loggedOut.headers.get('location'), '/login')
    const after = await session.request('/dashboard')
    assert.equal(after.headers.get('location'), '/login')
  })

  test('an account that is not an operator cannot start', async ({ assert }) => {
    const { customer, operator } = await createAccounts()
    const session = new FormSession()
    await session.login(customer.email, password)

    await session.request('/masquerade/accounts')
    assert.include(session.html, 'Your account is not a masquerade operator.')
    // The page offers no form, so take the context token from the status endpoint.
    const status = await session.request('/masquerade', undefined, 'application/json')
    const { contextToken } = (await status.json()) as { contextToken: string }
    const refused = await session.request('/masquerade/start', {
      _masqueradeContext: contextToken,
      targetId: String(operator.id),
    })
    assert.equal(refused.headers.get('location'), '/masquerade/accounts')
    await session.request('/masquerade/accounts')
    assert.include(session.html, 'You cannot act as that account.')
    assert.lengthOf(await db.from('masquerade_modes').where('state', 'active'), 0)
    await session.request('/dashboard')
    assert.include(session.html, 'Signed in as <strong>customer@example.test</strong>')
  })

  test('an operator cannot act as another operator', async ({ assert }) => {
    const { operator, secondOperator } = await createAccounts()
    const session = new FormSession()
    await session.login(operator.email, password)

    await session.request('/masquerade/accounts')
    assert.notInclude(session.html, 'second-operator@example.test')
    await start(session, secondOperator)
    await session.request('/masquerade/accounts')
    assert.include(session.html, 'You cannot act as that account.')
    await session.request('/dashboard')
    assert.include(session.html, 'Signed in as <strong>operator@example.test</strong>')
  })
})
