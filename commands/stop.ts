import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import { MasqueradeError } from '../src/errors.js'
import { stopActiveModes } from '../src/stop_modes.js'
import type { MasqueradeConfig } from '../src/types.js'

/** End one operator's active mode, or every active mode, from the server. */
export default class StopCommand extends BaseCommand {
  static commandName = 'masquerade:stop'
  static description = "End an operator's active masquerade mode, or every active mode"
  static options = { startApp: true }

  @flags.string({ description: 'Operator account ID whose mode ends' })
  declare actor: string

  @flags.string({ description: 'Operator incarnation, for a deleted or reused account' })
  declare incarnation: string

  @flags.boolean({ description: 'End every active mode' })
  declare all: boolean

  @flags.boolean({ description: 'Skip the confirmation for --all' })
  declare force: boolean

  async run(): Promise<void> {
    if ((this.actor === undefined) === (this.all !== true)) {
      this.logger.error('Pass exactly one of --actor <id> or --all.')
      this.exitCode = 1
      return
    }
    if (this.all && this.incarnation !== undefined) {
      this.logger.error('--incarnation applies only with --actor.')
      this.exitCode = 1
      return
    }
    if (
      this.all &&
      this.force !== true &&
      !(await this.prompt.confirm('End every active masquerade mode?'))
    ) {
      this.logger.info('Nothing stopped.')
      return
    }
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
    let result
    try {
      result = await stopActiveModes(
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
        this.all ? { all: true } : { actorId: this.actor, actorIncarnation: this.incarnation }
      )
    } catch (error) {
      if (error instanceof MasqueradeError && error.code === 'E_MASQUERADE_INVALID_INPUT') {
        this.logger.error(
          'Unknown operator account; pass --incarnation with the value from masquerade:status.'
        )
        this.exitCode = 1
        return
      }
      throw error
    }
    this.logger.info(`Stopped ${result.stopped} mode(s).`)
  }
}
