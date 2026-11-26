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

type DemoEnvironment = { nodeEnv?: string; dbClient?: string }

/** Create or refresh the three reserved demo accounts without touching other users. */
export async function seedDemoAccounts(
  environment: DemoEnvironment = config.get<DemoEnvironment>('demo.environment')
): Promise<void> {
  assertDemoEnvironmentAllowed(environment)

  await db.transaction(async (trx) => {
    for (const account of demoAccounts) {
      await User.updateOrCreate({ email: account.email }, { ...account }, { client: trx })
    }
  })
}

/** Delete only the reserved demo accounts from the local SQLite fixture database. */
export async function resetDemoAccounts(
  environment: DemoEnvironment = config.get<DemoEnvironment>('demo.environment')
): Promise<void> {
  assertDemoEnvironmentAllowed(environment)

  await db.transaction(async (trx) => {
    const users = await trx.from('users').whereIn('email', demoEmails).select('id')
    const ids = users.map(({ id }) => String(id))
    if (ids.length === 0) return

    await trx.from('masquerade_events').whereIn('actor_id', ids).delete()
    await trx.from('masquerade_modes').whereIn('actor_id', ids).delete()
    await trx
      .from('remember_me_tokens')
      .whereIn(
        'tokenable_id',
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

/** Refuse demo commands outside development/test or when the app uses PostgreSQL. */
export function assertDemoEnvironmentAllowed(environment: DemoEnvironment): void {
  if (environment.nodeEnv !== 'development' && environment.nodeEnv !== 'test') {
    throw new Error('Demo commands are allowed only in development or test environments.')
  }
  if (environment.dbClient && environment.dbClient !== 'sqlite') {
    throw new Error('Demo commands are allowed only with the local SQLite database.')
  }
}
