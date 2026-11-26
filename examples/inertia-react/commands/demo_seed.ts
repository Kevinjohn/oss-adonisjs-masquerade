import { BaseCommand } from '@adonisjs/core/ace'
import { seedDemoAccounts, demoAccounts } from '#services/demo_accounts'

/** Seed the reserved fictional accounts used by the local masquerade demo. */
export default class DemoSeed extends BaseCommand {
  static commandName = 'demo:seed'
  static description = 'Create or refresh the fictional local demo accounts'
  static options = { startApp: true }

  async run(): Promise<void> {
    await seedDemoAccounts()
    this.logger.info('Created or refreshed the three fictional demo accounts:')
    for (const { email, password, masqueradeOperator } of demoAccounts) {
      this.logger.info(
        `  ${email} / ${password}${masqueradeOperator ? ' (operator)' : ' (customer)'}`
      )
    }
    this.logger.info('These credentials are for local demonstration only.')
  }
}
