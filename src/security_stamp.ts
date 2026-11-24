import { E_MASQUERADE_SECURITY_STAMP_INVALID } from './errors.js'
import { createHash } from 'node:crypto'

export function hashSecurityStamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    value.length === 0 ||
    Buffer.byteLength(value) > 512
  )
    throw new E_MASQUERADE_SECURITY_STAMP_INVALID()
  return createHash('sha256').update(value).digest('hex')
}
