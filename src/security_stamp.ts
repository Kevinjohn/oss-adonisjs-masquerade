import { createHash } from 'node:crypto'
import { unavailable } from './error_helpers.js'

export function stampHash(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    value.length === 0 ||
    Buffer.byteLength(value) > 512
  )
    throw unavailable()
  return createHash('sha256').update(value).digest('hex')
}
