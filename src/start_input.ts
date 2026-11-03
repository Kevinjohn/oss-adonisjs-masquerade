import { boundedString } from './bounded_string.js'
import { invalidInput } from './error_helpers.js'
import { parseStartReason } from './reason.js'
import type { ReasonPolicy } from './reason.js'
import type { ModeAccess, StartInput } from './types.js'

export function validateStartInputShape(input: StartInput): void {
  if (
    !input ||
    Object.keys(input).some(
      (key) => !['targetId', 'reason', 'durationSeconds', 'expectedContext', 'access'].includes(key)
    )
  )
    throw invalidInput()
}

/** Parse the selection only after context freshness and existing mode checks. */
export function parseStartSelection(
  input: StartInput,
  actorId: string,
  defaultDuration: number,
  maxDuration: number,
  reasonPolicy: ReasonPolicy
): { targetId: string; reason: string | null; duration: number; access: ModeAccess } {
  const reason = parseStartReason(input.reason, reasonPolicy)
  if (!(
    typeof input.targetId === 'string' ||
    (typeof input.targetId === 'number' && Number.isSafeInteger(input.targetId))
  ))
    throw invalidInput()
  const targetId = String(input.targetId)
  if (!boundedString(targetId, 255) || targetId === actorId) throw invalidInput()
  const duration = input.durationSeconds === undefined ? defaultDuration : input.durationSeconds
  if (!Number.isInteger(duration) || duration < 60 || duration > maxDuration) throw invalidInput()
  const access = input.access === undefined ? 'view' : input.access
  if (access !== 'view' && access !== 'edit') throw invalidInput()
  return { targetId, reason, duration, access }
}
