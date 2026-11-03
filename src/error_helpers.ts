import { MasqueradeError } from './errors.js'
import type { MasqueradeErrorCode } from './errors.js'

/** Stable request error codes; each maps to one HTTP status and English message. */
export const errorDetails = {
  E_MASQUERADE_UNAUTHENTICATED: [401, 'Actor authentication required'],
  E_MASQUERADE_NOT_ALLOWED: [403, 'Masquerade is not allowed'],
  E_MASQUERADE_ACTION_BLOCKED: [403, 'Action is blocked while masquerading'],
  E_MASQUERADE_ALREADY_ACTIVE: [409, 'Masquerade is already active'],
  E_MASQUERADE_CONTEXT_CHANGED: [409, 'Masquerade context changed'],
  E_MASQUERADE_INVALID_INPUT: [422, 'Invalid masquerade input'],
  E_MASQUERADE_CONTEXT_REQUIRED: [428, 'Masquerade context required'],
  E_MASQUERADE_UNAVAILABLE: [503, 'Masquerade is unavailable'],
} as const satisfies Record<MasqueradeErrorCode, readonly [number, string]>

export function unavailable(): MasqueradeError {
  return new MasqueradeError('E_MASQUERADE_UNAVAILABLE')
}

export function invalidInput(): MasqueradeError {
  return new MasqueradeError('E_MASQUERADE_INVALID_INPUT')
}
