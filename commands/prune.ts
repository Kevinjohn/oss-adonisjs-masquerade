import { debugLogger, reportObserverError } from '../src/debug.ts'
import { E_MASQUERADE_PRUNE_PROGRESS } from '../src/errors.ts'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import { pruneMasquerade, DEFAULT_PRUNE_BATCH_SIZE, MAX_PRUNE_BATCH_SIZE } from '../src/prune.ts'
import { resolveMasqueradeConfig } from '../src/define_config.ts'

/** Expire outdated modes and apply the configured audit-event retention permissions. */
export default class PruneCommand extends BaseCommand {
  static commandName = 'masquerade:prune'
  static description = 'Expire outdated masquerade modes and prune retained events'
  static options = { startApp: true }

  @flags.number({ description: 'Maximum rows and events processed in this pass' })
  declare batchSize: number

  async run(): Promise<void> {
    const batchSize = this.batchSize ?? DEFAULT_PRUNE_BATCH_SIZE
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_PRUNE_BATCH_SIZE)
      throw new InvalidArgumentsException(
        `--batch-size must be an integer from 1 to ${MAX_PRUNE_BATCH_SIZE}`
      )
    const config = await resolveMasqueradeConfig<object>(this.app)

    const emitterService = await this.app.container.make('emitter')
    const emitter = emitterService as unknown as {
      emit(name: string, event: unknown): unknown
    }
    const result = await pruneMasquerade(
      config,
      {
        environment: this.app.nodeEnvironment,
        emitter: { emit: (name, event) => emitter.emit(name, event) },
        logger: config.logger ?? debugLogger,
        observerErrorHandler: reportObserverError,
      },
      { batchSize }
    )
    this.logger.info(`Expired ${result.expired} mode(s); deleted ${result.eventsDeleted} event(s).`)
  }

  completed(): boolean {
    if (!(this.error instanceof E_MASQUERADE_PRUNE_PROGRESS)) return false
    const { phase, completed, indeterminate } = this.error
    this.logger.error(
      `Prune failed during ${phase}: confirmed expired ${completed.expired} mode(s); confirmed deleted ${completed.eventsDeleted} event(s).${indeterminate ? ' The failed operation may also have committed.' : ''}`
    )
    return true
  }
}
