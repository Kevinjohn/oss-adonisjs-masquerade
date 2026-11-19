import { isBoundedString } from './bounded_string.js'
import { createInvalidInputError } from './error_helpers.js'
import { requireStartReason } from './reason.js'
import type { ReasonPolicy } from './reason.js'
import type { ModeAccess, StartInput } from './types.js'

export function assertStartInputShape(input: StartInput): void {
  if (
    !input ||
    Object.keys(input).some(
      (key) => !['targetId', 'reason', 'durationSeconds', 'expectedContext', 'access'].includes(key)
    )
  )
    throw createInvalidInputError()
}

type StartSelectionOptions = {
  actorId: string
  defaultDuration: number
  maxDuration: number
  reasonPolicy: ReasonPolicy
}

/** Parse the selection only after context freshness and existing mode checks. */
export function requireStartSelection(
  input: StartInput,
  { actorId, defaultDuration, maxDuration, reasonPolicy }: StartSelectionOptions
): { targetId: string; reason: string | null; duration: number; access: ModeAccess } {
  const reason = requireStartReason(input.reason, reasonPolicy)
  if (!(
    typeof input.targetId === 'string' ||
    (typeof input.targetId === 'number' && Number.isSafeInteger(input.targetId))
  ))
    throw createInvalidInputError()
  const targetId = String(input.targetId)
  if (!isBoundedString(targetId, 255) || targetId === actorId) throw createInvalidInputError()
  const duration = input.durationSeconds === undefined ? defaultDuration : input.durationSeconds
  if (!Number.isInteger(duration) || duration < 60 || duration > maxDuration)
    throw createInvalidInputError()
  const access = input.access === undefined ? 'view' : input.access
  if (access !== 'view' && access !== 'edit') throw createInvalidInputError()
  return { targetId, reason, duration, access }
}
