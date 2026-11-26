import { BaseCommand } from '@adonisjs/core/ace'
import app from '@adonisjs/core/services/app'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import User from '#models/user'
import { demoAccounts, assertDemoEnvironmentAllowed } from '#services/demo_accounts'
import env from '#start/env'
import { DateTime } from 'luxon'

/** Add missing reserved accounts and restore their admission without changing existing user rows. */
export default class DemoKitSeedCommand extends BaseCommand {
  static commandName = 'demo:kit-seed'
  static description = 'Seed missing fictional Account Kit demo accounts'
  static options = { startApp: true }

  async run(): Promise<void> {
    assertDemoEnvironmentAllowed({ nodeEnv: env.get('NODE_ENV'), dbClient: process.env.DB_CLIENT })
    const admission = await app.container.make(AccountAdmission)
    for (const account of demoAccounts) {
      let user = await User.findBy('email', account.email)
      if (!user) {
        user = await User.create({ ...account, emailVerifiedAt: DateTime.utc() })
      }
      if (!(await admission.isAdmitted(user.id))) {
        await admission.operator.approve({ email: account.email })
      }
    }
    this.logger.info('The three fictional demo accounts are available.')
  }
}
