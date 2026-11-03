import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import { pruneMasquerade, DEFAULT_PRUNE_BATCH_SIZE } from '../src/prune.js'
import type { MasqueradeConfig } from '../src/types.js'

/** Expire outdated modes and apply the configured audit-event retention policy. */
export default class PruneCommand extends BaseCommand {
  static commandName = 'masquerade:prune'
  static description = 'Expire outdated masquerade modes and prune retained events'
  static options = { startApp: true }

  @flags.number({ description: 'Maximum rows and events processed in this pass' })
  declare batchSize: number

  async run(): Promise<void> {
    const batchSize = this.batchSize ?? DEFAULT_PRUNE_BATCH_SIZE
    const config = this.app.config.get('masquerade') as
      MasqueradeConfig<unknown, object> | undefined
    if (!config) throw new InvalidArgumentsException('Masquerade configuration is required')

    const [emitterService, logger] = await Promise.all([
      this.app.container.make('emitter'),
      this.app.container.make('logger'),
    ])
    const emitter = emitterService as unknown as {
      emit(name: string, event: unknown): unknown
    }
    const result = await pruneMasquerade(
      config,
      {
        environment: this.app.getEnvironment(),
        emitter: { emit: (name, event) => emitter.emit(name, event) },
        logger: {
          info: (event) => logger.info(event, 'Masquerade transition'),
          error: (event) => logger.error(event, 'Masquerade diagnostic'),
        },
        observerErrorHandler: () =>
          logger.error({ code: 'E_MASQUERADE_OBSERVER_FAILED' }, 'Masquerade observer failed'),
      },
      { batchSize }
    )
    this.logger.info(`Expired ${result.expired} mode(s); deleted ${result.eventsDeleted} event(s).`)
  }
}
