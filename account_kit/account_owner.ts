import type { NativeAuthority } from '../src/types.js'
import { isBoundedString } from '../src/bounded_string.js'
import { createUnavailableError } from '../src/error_helpers.js'

/** The string form of an Account Kit identifier; anything else fails closed. */
export function canonicalId(value: unknown): string {
  if (
    typeof value !== 'string' &&
    typeof value !== 'bigint' &&
    !(typeof value === 'number' && Number.isSafeInteger(value))
  )
    throw createUnavailableError()
  const id = String(value)
  if (!isBoundedString(id, 255)) throw createUnavailableError()
  return id
}

/**
 * The account identity Masquerade keys mode state by. Admission and the Account Kit blocker both
 * derive it here, so they always name the same owner row.
 */
export function accountOwner<User>(
  incarnation: NativeAuthority<User>['incarnation'],
  user: User,
  identifier: unknown
): { id: string; incarnation: string } {
  const id = canonicalId(identifier)
  const accountIncarnation = incarnation === 'id' ? id : incarnation(user)
  if (!isBoundedString(accountIncarnation, 128)) throw createUnavailableError()
  return { id, incarnation: accountIncarnation }
}
