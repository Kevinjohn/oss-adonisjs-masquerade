import type { HttpContext } from '@adonisjs/core/http'
import type { ModeAccess, SubjectId } from '../src/types.js'
import { runtimeFor } from '../src/integration/runtime.js'

/** Safe identity fields for a host business audit record; every key is always present. */
export interface MasqueradeAuditFields {
  readonly actorId: SubjectId
  readonly actorIncarnation: string
  readonly effectiveId: SubjectId
  readonly effectiveIncarnation: string
  readonly isMasquerading: boolean
  readonly modeId: string | null
  readonly access: ModeAccess | null
}

/**
 * Resolve the actor and effective identity to spread into the host's own audit writer. On a route
 * that does not select an effective guard the handler runs as the actor, so both identities are
 * the actor and no mode is admitted, invalidated or reported.
 */
export async function masqueradeAuditFields(ctx: HttpContext): Promise<MasqueradeAuditFields> {
  const runtime = await runtimeFor(ctx)
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
