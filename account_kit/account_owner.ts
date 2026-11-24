import {
  E_MASQUERADE_ACCOUNT_ID_INVALID,
  E_MASQUERADE_ACCOUNT_INCARNATION_INVALID,
} from '../src/errors.js'
import type { NativeAuthority } from '../src/types.js'
import { isBoundedString } from '../src/bounded_string.js'

/** The string form of an Account Kit identifier; anything else fails closed. */
export function requireCanonicalId(value: unknown): string {
  if (
    typeof value !== 'string' &&
    typeof value !== 'bigint' &&
    !(typeof value === 'number' && Number.isSafeInteger(value))
  )
    throw new E_MASQUERADE_ACCOUNT_ID_INVALID()
  const id = String(value)
  if (!isBoundedString(id, 255)) throw new E_MASQUERADE_ACCOUNT_ID_INVALID()
  return id
}

/**
 * The account identity Masquerade keys mode state by. Admission and the Account Kit blocker both
 * derive it here, so they always name the same owner row.
 */
export function resolveAccountOwner<User>(
  incarnation: NativeAuthority<User>['incarnation'],
  user: User,
  identifier: unknown
): { id: string; incarnation: string } {
  const id = requireCanonicalId(identifier)
  const accountIncarnation = incarnation === 'id' ? id : incarnation(user)
  if (!isBoundedString(accountIncarnation, 128))
    throw new E_MASQUERADE_ACCOUNT_INCARNATION_INVALID()
  return { id, incarnation: accountIncarnation }
}
