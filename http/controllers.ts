import type { HttpContext } from '@adonisjs/core/http'
import { runtimeFor } from '../integration/runtime.js'
import { MasqueradeError } from '../src/errors.js'
import { parseStartControl, parseStopControl } from './control_input.js'

/** Opt-in controller for GET /masquerade, POST /start, and POST /stop. */
export class MasqueradeController {
  async status(ctx: HttpContext): Promise<void> {
    await this.control(ctx, async (runtime) => runtime.service.status(ctx))
  }

  async start(ctx: HttpContext): Promise<void> {
    await this.control(ctx, async (runtime) => runtime.service.start(ctx, parseStartControl(ctx)))
  }

  async stop(ctx: HttpContext): Promise<void> {
    await this.control(ctx, async (runtime) => runtime.service.stop(ctx, parseStopControl(ctx)))
  }

  private async control(
    ctx: HttpContext,
    action: (runtime: Awaited<ReturnType<typeof runtimeFor>>) => Promise<unknown>
  ): Promise<void> {
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.vary(['Accept', 'X-Masquerade-Context'])
    const runtime = await runtimeFor(ctx)
    if (runtime.selectGuard(ctx).kind !== 'raw')
      throw new MasqueradeError('E_MASQUERADE_UNAVAILABLE')
    const result = await action(runtime)
    ctx.response.status(200).json(result)
  }
}
