import { BaseCommand } from '@adonisjs/core/ace'
import { issueDemoToken } from '#services/demo_token'

/** Issue a one-hour bearer credential for the seeded local demo operator. */
export default class DemoToken extends BaseCommand {
  static commandName = 'demo:token'
  static description = 'Issue a restricted bearer token for the local support demo'
  static options = { startApp: true }

  async run(): Promise<void> {
    const credential = await issueDemoToken()
    process.stdout.write(`${JSON.stringify(credential)}\n`)
  }
}
