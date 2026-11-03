import { invalidInput } from './error_helpers.js'

export type ReasonPolicy = 'optional' | 'required'

export function normalizeReason(value: unknown): string {
  if (typeof value !== 'string') throw invalidInput()
  const reason = value.trim().replace(/\r\n/g, '\n')
  if (
    !reason ||
    // Only LF and TAB are permitted inside a normalized reason.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(reason) ||
    [...reason].length > 500 ||
    Buffer.byteLength(reason) > 2000
  )
    throw invalidInput()
  return reason
}

/** An optional reason that is absent, null or blank is stored as null; any other value is normalized. */
export function parseStartReason(value: unknown, policy: ReasonPolicy): string | null {
  if (
    policy === 'optional' &&
    (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
  )
    return null
  return normalizeReason(value)
}
