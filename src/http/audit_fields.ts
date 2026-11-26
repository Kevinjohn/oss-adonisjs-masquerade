import type { MasqueradeAuditFields } from '../types.ts'
import type { HttpContext } from '@adonisjs/core/http'
import { resolveRuntime } from '../integration/runtime.ts'

/** Safe actor and effective identity for application audit writers. */
class MasqueradeAudit {
  /**
   * Resolve the actor and effective identity to spread into the host's own audit writer. On a route
   * that does not select an effective guard the handler runs as the actor, so both identities are
   * the actor and no mode is admitted, invalidated or reported.
   *
   * @example
   * ```ts
   * import { masqueradeAudit } from '@kevinjohn/adonisjs-masquerade/http'
   * import type { HttpContext } from '@adonisjs/core/http'
   *
   * export async function logPreferenceUpdate(ctx: HttpContext) {
   *   ctx.logger.info(await masqueradeAudit.fields(ctx), 'Customer preference updated')
   * }
   * ```
   */
  async fields(ctx: HttpContext): Promise<MasqueradeAuditFields> {
    const runtime = await resolveRuntime(ctx)
    if (runtime.selectGuard(ctx).kind !== 'effective') {
      const actor = await runtime.actor(ctx)
      return Object.freeze({
        actorId: actor.id,
        actorIncarnation: actor.incarnation,
        effectiveId: actor.id,
        effectiveIncarnation: actor.incarnation,
        isMasquerading: false,
        modeId: null,
        access: null,
      })
    }
    const identity = await runtime.service.resolve(ctx)
    return Object.freeze({
      actorId: identity.actorId,
      actorIncarnation: identity.actorIncarnation,
      effectiveId: identity.effectiveId,
      effectiveIncarnation: identity.effectiveIncarnation,
      isMasquerading: identity.isMasquerading,
      modeId: identity.modeId ?? null,
      access: identity.access ?? null,
    })
  }
}

/**
 * Resolve the actor and effective identity to spread into the host's own audit writer. On a route
 * that does not select an effective guard the handler runs as the actor, so both identities are
 * the actor and no mode is admitted, invalidated or reported.
 *
 * @example
 * ```ts
 * import { masqueradeAudit } from '@kevinjohn/adonisjs-masquerade/http'
 * import type { HttpContext } from '@adonisjs/core/http'
 *
 * export async function logPreferenceUpdate(ctx: HttpContext) {
 *   ctx.logger.info(await masqueradeAudit.fields(ctx), 'Customer preference updated')
 * }
 * ```
 */
export const masqueradeAudit = new MasqueradeAudit()
