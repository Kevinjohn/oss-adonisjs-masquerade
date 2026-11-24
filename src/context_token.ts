import { E_MASQUERADE_CONTEXT_CHANGED, E_MASQUERADE_CONTEXT_REQUIRED } from './errors.js'
import { createHash } from 'node:crypto'
import type { ModeRow, OwnerKey } from './types.js'

export function buildContextToken(owner: OwnerKey, row: ModeRow | null): string {
  if (row) return `${row.revision}.${row.revisionNonce}`
  const tuple = [owner.namespace, owner.actorId, owner.actorIncarnation]
    .map((part) => `${Buffer.byteLength(part)}:${part}`)
    .join('')
  return `0.${createHash('sha256').update(tuple).digest('hex')}`
}
export function requireContext(value: unknown, current: string): void {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value) > 128 ||
    !/^(0|[1-9]\d{0,15})\.[0-9a-f]{32}(?:[0-9a-f]{32})?$/.test(value) ||
    !Number.isSafeInteger(Number(value.split('.')[0]))
  )
    throw new E_MASQUERADE_CONTEXT_REQUIRED()
  if (value !== current) throw new E_MASQUERADE_CONTEXT_CHANGED()
}
