import { BaseCommand } from '@adonisjs/core/ace'
import { resetDemoAccounts } from '#services/demo_accounts'

export default class DemoReset extends BaseCommand {
  static commandName = 'demo:reset'
  static description = 'Remove the fictional local demo accounts'
  static options = { startApp: true }

  async run() {
    await resetDemoAccounts()
    this.logger.info('Removed the fictional local demo accounts.')
  }
}
