import { E_MASQUERADE_UNAVAILABLE } from './errors.js'
import { isBoundedString } from './bounded_string.js'
import { normalizeReason } from './reason.js'
import type { ModeRow, OwnerKey } from './types.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hash = /^[0-9a-f]{64}$/
export function isValidInstant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
export function requireValidModeRow(row: ModeRow | null, owner: OwnerKey): ModeRow | null {
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
    !isValidInstant(row.updatedAt)
  )
    throw new E_MASQUERADE_UNAVAILABLE()
  if (row.state === 'idle') {
    if (row.access !== null) throw new E_MASQUERADE_UNAVAILABLE()
    for (const value of [
      row.targetId,
      row.targetIncarnation,
      row.actorStampHash,
      row.targetStampHash,
      row.reason,
      row.startedAt,
      row.expiresAt,
    ])
      if (value !== null) throw new E_MASQUERADE_UNAVAILABLE()
  } else if (row.state === 'active') {
    if (
      (row.access !== 'view' && row.access !== 'edit') ||
      !isBoundedString(row.targetId, 255) ||
      !isBoundedString(row.targetIncarnation, 128) ||
      typeof row.actorStampHash !== 'string' ||
      !hash.test(row.actorStampHash) ||
      typeof row.targetStampHash !== 'string' ||
      !hash.test(row.targetStampHash) ||
      !isValidInstant(row.startedAt) ||
      !isValidInstant(row.expiresAt) ||
      row.expiresAt <= row.startedAt ||
      Date.parse(row.expiresAt) - Date.parse(row.startedAt) > 3600000
    )
      throw new E_MASQUERADE_UNAVAILABLE()
    try {
      if (row.reason !== null && normalizeReason(row.reason) !== row.reason)
        throw new E_MASQUERADE_UNAVAILABLE()
    } catch {
      throw new E_MASQUERADE_UNAVAILABLE()
    }
  } else throw new E_MASQUERADE_UNAVAILABLE()
  return row
}
