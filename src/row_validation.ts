import { unavailable } from './error_helpers.js'
import { boundedString } from './bounded_string.js'
import { normalizeReason } from './reason.js'
import type { ModeRow, OwnerKey } from './types.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hash = /^[0-9a-f]{64}$/
export function validInstant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
export function validateRow(row: ModeRow | null, owner: OwnerKey): ModeRow | null {
  if (row === null) return null
  if (
    !row ||
    row.namespace !== owner.namespace ||
    row.actorId !== owner.actorId ||
    row.actorIncarnation !== owner.actorIncarnation ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    typeof row.revisionNonce !== 'string' ||
    !/^[0-9a-f]{32}$/.test(row.revisionNonce) ||
    typeof row.modeId !== 'string' ||
    !uuid.test(row.modeId) ||
    typeof row.lastTransitionId !== 'string' ||
    !uuid.test(row.lastTransitionId) ||
    !validInstant(row.updatedAt)
  )
    throw unavailable()
  if (row.state === 'idle') {
    if (row.access !== null) throw unavailable()
    for (const value of [
      row.targetId,
      row.targetIncarnation,
      row.actorStampHash,
      row.targetStampHash,
      row.reason,
      row.startedAt,
      row.expiresAt,
    ])
      if (value !== null) throw unavailable()
  } else if (row.state === 'active') {
    if (
      (row.access !== 'view' && row.access !== 'edit') ||
      !boundedString(row.targetId, 255) ||
      !boundedString(row.targetIncarnation, 128) ||
      typeof row.actorStampHash !== 'string' ||
      !hash.test(row.actorStampHash) ||
      typeof row.targetStampHash !== 'string' ||
      !hash.test(row.targetStampHash) ||
      !validInstant(row.startedAt) ||
      !validInstant(row.expiresAt) ||
      row.expiresAt <= row.startedAt ||
      Date.parse(row.expiresAt) - Date.parse(row.startedAt) > 3600000
    )
      throw unavailable()
    try {
      if (row.reason !== null && normalizeReason(row.reason) !== row.reason) throw unavailable()
    } catch {
      throw unavailable()
    }
  } else throw unavailable()
  return row
}
