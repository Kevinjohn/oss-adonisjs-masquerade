import config from '@adonisjs/core/services/config'
import User from '#models/user'
import { assertDemoEnvironmentAllowed, demoAccounts } from '#services/demo_accounts'

const operatorAccount = demoAccounts.find((account) => account.masqueradeOperator)!
const customerAccounts = demoAccounts.filter((account) => !account.masqueradeOperator)

type DemoTokenEnvironment = { nodeEnv?: string; dbClient?: string }

/** Issue a short-lived bearer credential for the reserved local support operator. */
export async function issueDemoToken(
  environment: DemoTokenEnvironment = config.get<DemoTokenEnvironment>('demo.environment')
) {
  assertDemoEnvironmentAllowed(environment)

  const operator = await User.findBy('email', operatorAccount.email)
  if (!operator?.active || !operator.masqueradeOperator) {
    throw new Error('The seeded demo operator must be active and allowed to use masquerade.')
  }

  const customers = []
  for (const account of customerAccounts) {
    const customer = await User.findBy('email', account.email)
    if (!customer?.active || customer.masqueradeOperator) {
      throw new Error('Both seeded demo customers must exist, be active, and be eligible targets.')
    }
    customers.push(customer)
  }

  const accessToken = await User.accessTokens.create(operator, ['masquerade'], {
    name: 'local-support-demo',
    expiresIn: '1h',
  })
  if (!accessToken.value || !accessToken.expiresAt) {
    throw new Error('The native token provider did not return a finite demo credential.')
  }

  return {
    token: accessToken.value.release(),
    tokenId: String(accessToken.identifier),
    expiresAt: accessToken.expiresAt.toISOString(),
    operator: { id: String(operator.id), email: operator.email },
    customers: customers.map((customer) => ({ id: String(customer.id), email: customer.email })),
  }
}
