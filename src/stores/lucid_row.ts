import { E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import { isBoundedString } from '../bounded_string.ts'
import { requireValidModeRow } from '../row_validation.ts'
import type { AuditEvent, ModeRow, OwnerKey } from '../types.ts'

export const ownerColumns = ['authority_namespace', 'actor_id', 'actor_incarnation']
export function buildOwnerRecord(owner: OwnerKey) {
  return {
    authority_namespace: owner.namespace,
    actor_id: owner.actorId,
    actor_incarnation: owner.actorIncarnation,
  }
}
export function buildModeRecord(row: ModeRow) {
  return {
    ...buildOwnerRecord(row),
    revision: row.revision,
    revision_nonce: row.revisionNonce,
    state: row.state,
    access: row.access,
    mode_id: row.modeId,
    last_transition_id: row.lastTransitionId,
    target_id: row.targetId,
    target_incarnation: row.targetIncarnation,
    actor_stamp_hash: row.actorStampHash,
    target_stamp_hash: row.targetStampHash,
    reason: row.reason,
    started_at: row.startedAt,
    expires_at: row.expiresAt,
    updated_at: row.updatedAt,
  }
}
export function buildAuditRecord(event: AuditEvent) {
  return {
    ...buildOwnerRecord(event),
    id: event.id,
    mode_id: event.modeId ?? null,
    target_id: event.targetId ?? null,
    target_incarnation: event.targetIncarnation ?? null,
    at: event.at,
    kind: event.kind,
    outcome_code: event.outcomeCode,
    access: event.access ?? null,
    revision: event.revision,
    reason: event.reason ?? null,
  }
}
export function requireRevision(value: unknown): number {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) value = Number(value)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new E_MASQUERADE_UNAVAILABLE()
  return value
}
export function decodeRow(raw: Record<string, unknown>, owner?: OwnerKey): ModeRow {
  const key = {
    namespace: raw.authority_namespace,
    actorId: raw.actor_id,
    actorIncarnation: raw.actor_incarnation,
  }
  if (
    !isBoundedString(key.namespace, 128) ||
    !isBoundedString(key.actorId, 255) ||
    !isBoundedString(key.actorIncarnation, 128)
  )
    throw new E_MASQUERADE_UNAVAILABLE()
  const row = {
    ...key,
    revision: requireRevision(raw.revision),
    revisionNonce: raw.revision_nonce,
    state: raw.state,
    access: raw.access,
    modeId: raw.mode_id,
    lastTransitionId: raw.last_transition_id,
    targetId: raw.target_id,
    targetIncarnation: raw.target_incarnation,
    actorStampHash: raw.actor_stamp_hash,
    targetStampHash: raw.target_stamp_hash,
    reason: raw.reason,
    startedAt: raw.started_at,
    expiresAt: raw.expires_at,
    updatedAt: raw.updated_at,
  } as ModeRow
  return requireValidModeRow(row, owner ?? row)!
}
