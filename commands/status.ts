import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import {
  DEFAULT_ACTIVE_MODE_LIMIT,
  MAX_ACTIVE_MODE_LIMIT,
  listActiveModes,
} from '../src/active_modes.js'
import type { MasqueradeConfig } from '../src/types.js'

/** List active modes so an operator can see who is viewing which account. */
export default class StatusCommand extends BaseCommand {
  static commandName = 'masquerade:status'
  static description = 'List active masquerade modes'
  static options = { startApp: true }

  @flags.number({ description: 'Maximum modes to list' })
  declare limit: number

  async run(): Promise<void> {
    const limit = this.limit ?? DEFAULT_ACTIVE_MODE_LIMIT
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ACTIVE_MODE_LIMIT)
      throw new InvalidArgumentsException(
        `--limit must be an integer from 1 to ${MAX_ACTIVE_MODE_LIMIT}`
      )
    const config = this.app.config.get('masquerade') as
      MasqueradeConfig<unknown, object> | undefined
    if (!config) throw new InvalidArgumentsException('Masquerade configuration is required')
    const modes = await listActiveModes(
      config,
      { environment: this.app.getEnvironment() },
      { limit }
    )
    if (modes.length === 0) {
      this.logger.info('No active masquerade modes.')
      return
    }
    const table = this.ui.table()
    table.head(['Namespace', 'Actor', 'Incarnation', 'Target', 'Access', 'Expires'])
    for (const mode of modes)
      table.row([
        mode.namespace,
        mode.actorId,
        mode.actorIncarnation,
        mode.targetId,
        mode.access,
        mode.expiresAt,
      ])
    table.render()
    if (modes.length === limit)
      this.logger.info(`Showing the first ${limit} mode(s); pass --limit to see more.`)
  }
}
