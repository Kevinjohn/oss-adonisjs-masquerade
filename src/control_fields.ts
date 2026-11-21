import { createInvalidInputError } from './error_helpers.js'

/** Check raw control keys, leaving individual values unvalidated for the ordered service checks. */
export function requireControlFields(
  input: unknown,
  allowed: readonly string[]
): Record<string, unknown> {
  if (!input) throw createInvalidInputError()
  // Match the existing Object.keys/property-access semantics for malformed direct callers.
  // Transport adapters supply objects, including the invalid-input sentinel.
  const fields: Record<string, unknown> = Object(input)
  if (Object.keys(fields).some((key) => !allowed.includes(key))) throw createInvalidInputError()
  return fields
}
