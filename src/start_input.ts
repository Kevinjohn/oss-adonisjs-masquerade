import { E_MASQUERADE_INVALID_INPUT, E_MASQUERADE_SELF_TARGET } from './errors.js'
import { isBoundedString } from './bounded_string.js'
import { requireStartReason } from './reason.js'
import type { ReasonRequirement } from './reason.js'
import type { ModeAccess } from './types.js'

type StartSelectionOptions = {
  actorId: string
  defaultDuration: number
  maxDuration: number
  reasonRequirement: ReasonRequirement
}

/** Parse the selection only after context freshness and existing mode checks. */
export function requireStartSelection(
  input: Record<string, unknown>,
  { actorId, defaultDuration, maxDuration, reasonRequirement }: StartSelectionOptions
): { targetId: string; reason: string | null; duration: number; access: ModeAccess } {
  const reason = requireStartReason(input.reason, reasonRequirement)
  if (!(
    typeof input.targetId === 'string' ||
    (typeof input.targetId === 'number' && Number.isSafeInteger(input.targetId))
  ))
    throw new E_MASQUERADE_INVALID_INPUT()
  const targetId = String(input.targetId)
  if (!isBoundedString(targetId, 255)) throw new E_MASQUERADE_INVALID_INPUT()
  if (targetId === actorId) throw new E_MASQUERADE_SELF_TARGET()
  const duration = input.durationSeconds === undefined ? defaultDuration : input.durationSeconds
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < 60 ||
    duration > maxDuration
  )
    throw new E_MASQUERADE_INVALID_INPUT()
  const access = input.access === undefined ? 'view' : input.access
  if (access !== 'view' && access !== 'edit') throw new E_MASQUERADE_INVALID_INPUT()
  return { targetId, reason, duration, access }
}
