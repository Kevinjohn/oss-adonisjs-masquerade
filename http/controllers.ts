import { E_MASQUERADE_UNAVAILABLE } from '../src/errors.js'
import type { HttpContext } from '@adonisjs/core/http'
import { resolveRuntime } from '../src/integration/runtime.js'
import {
  parseStartControlOrInvalidMarker,
  parseStopControlOrInvalidMarker,
} from './control_input.js'
import type { MasqueradeService, ModeView } from '../src/types.js'

// The concrete core implements start/stop with unknown inputs; the host-facing service
// interface deliberately retains its typed inputs. Only the transport adapter widens these
// methods, so the audit boundary receives (and validates) the untrusted data.
type RawControlService = MasqueradeService<HttpContext> & {
  start(ctx: HttpContext, input: unknown): Promise<ModeView>
  stop(ctx: HttpContext, input: unknown): Promise<ModeView>
}

/**
 * Opt-in controller for GET /masquerade, POST /start, and POST /stop.
 *
 * @example
 * ```ts
 * import { MasqueradeController } from '@kevinjohn/adonisjs-masquerade/http'
 * import type { HttpContext } from '@adonisjs/core/http'
 *
 * export default class SupportController extends MasqueradeController {
 *   override async status(ctx: HttpContext) {
 *     ctx.response.header('X-Support-Controls', 'enabled')
 *     return super.status(ctx)
 *   }
 * }
 * ```
 */
export class MasqueradeController {
  /** `GET /`: the actor's current `ModeView`. */
  async status(ctx: HttpContext): Promise<void> {
    await this.control(ctx, async (runtime) => runtime.service.status(ctx))
  }

  /** `POST /start`: pass the raw control input to the service for validation and audit. */
  async start(ctx: HttpContext): Promise<void> {
    await this.control(ctx, async (runtime) =>
      (runtime.service as RawControlService).start(ctx, parseStartControlOrInvalidMarker(ctx))
    )
  }

  /** `POST /stop`: pass the raw control input to the service for validation and audit. */
  async stop(ctx: HttpContext): Promise<void> {
    await this.control(ctx, async (runtime) =>
      (runtime.service as RawControlService).stop(ctx, parseStopControlOrInvalidMarker(ctx))
    )
  }

  /** Shared by the generated HTML adapter, which accepts only URL-encoded forms. */
  protected async formTransition(ctx: HttpContext, action: 'start' | 'stop'): Promise<ModeView> {
    const runtime = await this.requireRawRuntime(ctx)
    const service = runtime.service as RawControlService
    return action === 'start'
      ? service.start(ctx, parseStartControlOrInvalidMarker(ctx, { formOnly: true }))
      : service.stop(ctx, parseStopControlOrInvalidMarker(ctx, { formOnly: true }))
  }

  private async requireRawRuntime(ctx: HttpContext) {
    const runtime = await resolveRuntime(ctx)
    if (runtime.selectGuard(ctx).kind !== 'raw') throw new E_MASQUERADE_UNAVAILABLE()
    return runtime
  }

  private async control(
    ctx: HttpContext,
    action: (runtime: Awaited<ReturnType<typeof resolveRuntime>>) => Promise<unknown>
  ): Promise<void> {
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.vary(['Accept', 'X-Masquerade-Context'])
    const runtime = await this.requireRawRuntime(ctx)
    const result = await action(runtime)
    ctx.response.status(200).json(result)
  }
}
