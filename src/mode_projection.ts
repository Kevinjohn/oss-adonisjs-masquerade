import { buildContextToken } from './context_token.ts'
import type { RequestAdmission } from './types.ts'
import type { ModeRow, ModeView, OwnerKey, ResolvedContext, Subject } from './types.ts'

export function buildModeView(owner: OwnerKey, row: ModeRow | null): ModeView {
  const token = buildContextToken(owner, row)
  return Object.freeze(
    row?.state === 'active'
      ? {
          isMasquerading: true,
          contextToken: token,
          targetId: row.targetId,
          access: row.access,
          startedAt: row.startedAt,
          expiresAt: row.expiresAt,
        }
      : { isMasquerading: false, contextToken: token }
  )
}

export function buildAdmittedProjection<User>(
  owner: OwnerKey,
  row: ModeRow | null,
  actor: Subject<User>,
  effective: Subject<User>
): RequestAdmission<User> {
  const context: ResolvedContext = Object.freeze({
    ...owner,
    effectiveId: effective.id,
    effectiveIncarnation: effective.incarnation,
    contextToken: buildContextToken(owner, row),
    ...(row?.state === 'active'
      ? { isMasquerading: true as const, modeId: row.modeId, access: row.access }
      : { isMasquerading: false as const }),
  })
  return Object.freeze({
    context,
    view: buildModeView(owner, row),
    actor: Object.freeze({ id: actor.id, incarnation: actor.incarnation, user: actor.user }),
    effective: Object.freeze({
      id: effective.id,
      incarnation: effective.incarnation,
      user: effective.user,
    }),
  })
}
