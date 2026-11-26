import config from '@adonisjs/core/services/config'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

export const demoAccounts = [
  {
    email: 'operator@example.test',
    fullName: 'Demo Operator',
    password: 'demo-operator-2026',
    active: true,
    canMutate: false,
    masqueradeOperator: true,
    securityStamp: 'demo-operator-v1',
  },
  {
    email: 'customer-one@example.test',
    fullName: 'Customer One',
    password: 'demo-customer-one-2026',
    active: true,
    canMutate: true,
    masqueradeOperator: false,
    securityStamp: 'demo-customer-one-v1',
  },
  {
    email: 'customer-two@example.test',
    fullName: 'Customer Two',
    password: 'demo-customer-two-2026',
    active: true,
    canMutate: true,
    masqueradeOperator: false,
    securityStamp: 'demo-customer-two-v1',
  },
] as const

const demoEmails = demoAccounts.map(({ email }) => email)

export async function seedDemoAccounts(
  environment = config.get<{ nodeEnv?: string; dbClient?: string }>('demo.environment')
) {
  assertDemoEnvironmentAllowed(environment)
  await db.transaction(async (trx) => {
    for (const account of demoAccounts) {
      await User.updateOrCreate({ email: account.email }, { ...account }, { client: trx })
    }
  })
}

export async function resetDemoAccounts(
  environment = config.get<{ nodeEnv?: string; dbClient?: string }>('demo.environment')
) {
  assertDemoEnvironmentAllowed(environment)
  await db.transaction(async (trx) => {
    const users = await trx.from('users').whereIn('email', demoEmails).select('id')
    const ids = users.map(({ id }) => String(id))
    if (!ids.length) return
    await trx.from('masquerade_events').whereIn('actor_id', ids).delete()
    await trx.from('masquerade_modes').whereIn('actor_id', ids).delete()
    await trx
      .from('demo_preferences')
      .whereIn(
        'user_id',
        users.map(({ id }) => id)
      )
      .delete()
    await trx
      .from('users')
      .whereIn(
        'id',
        users.map(({ id }) => id)
      )
      .delete()
  })
}

export function assertDemoEnvironmentAllowed(environment: { nodeEnv?: string; dbClient?: string }) {
  if (environment.nodeEnv !== 'development' && environment.nodeEnv !== 'test') {
    throw new Error('Demo commands are allowed only in development or test environments.')
  }
  if (environment.dbClient && environment.dbClient !== 'sqlite') {
    throw new Error('Demo commands are allowed only with the local SQLite database.')
  }
}
