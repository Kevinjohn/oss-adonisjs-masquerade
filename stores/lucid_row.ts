import { unavailable } from '../src/error_helpers.js'
import { boundedString } from '../src/bounded_string.js'
import { validateRow } from '../src/row_validation.js'
import type { AuditEvent, ModeRow, OwnerKey } from '../src/types.js'

export const ownerColumns = ['authority_namespace', 'actor_id', 'actor_incarnation']
export function ownerRecord(owner: OwnerKey) {
  return {
    authority_namespace: owner.namespace,
    actor_id: owner.actorId,
    actor_incarnation: owner.actorIncarnation,
  }
}
export function rowRecord(row: ModeRow) {
  return {
    ...ownerRecord(row),
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
export function eventRecord(event: AuditEvent) {
  return {
    ...ownerRecord(event),
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
export function parseRevision(value: unknown): number {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) value = Number(value)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw unavailable()
  return value
}
export function decodeRow(raw: Record<string, unknown>, owner?: OwnerKey): ModeRow {
  const key = {
    namespace: raw.authority_namespace,
    actorId: raw.actor_id,
    actorIncarnation: raw.actor_incarnation,
  }
  if (
    !boundedString(key.namespace, 128) ||
    !boundedString(key.actorId, 255) ||
    !boundedString(key.actorIncarnation, 128)
  )
    throw unavailable()
  const row = {
    ...key,
    revision: parseRevision(raw.revision),
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
  return validateRow(row, owner ?? row)!
}
