import { createHash } from 'node:crypto'
import { createUnavailableError } from './error_helpers.js'

export function hashSecurityStamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    value.length === 0 ||
    Buffer.byteLength(value) > 512
  )
    throw createUnavailableError()
  return createHash('sha256').update(value).digest('hex')
}
