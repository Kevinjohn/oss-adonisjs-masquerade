import { BaseCommand } from '@adonisjs/core/ace'
import { demoAccounts, seedDemoAccounts } from '#services/demo_accounts'

export default class DemoSeed extends BaseCommand {
  static commandName = 'demo:seed'
  static description = 'Create or refresh the fictional local demo accounts'
  static options = { startApp: true }

  async run() {
    await seedDemoAccounts()
    this.logger.info('Seeded local demo accounts:')
    for (const { email, password, masqueradeOperator } of demoAccounts) {
      this.logger.info(
        `  ${email} / ${password}${masqueradeOperator ? ' (operator)' : ' (customer)'}`
      )
    }
    this.logger.info('These credentials are for local demonstration only.')
  }
}
