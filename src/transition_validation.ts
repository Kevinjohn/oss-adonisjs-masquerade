import { unavailable } from './error_helpers.js'
import type { CompareAndSetInput, ModeRow } from './types.js'

/** Checks that the audit record describes the state change carried by the CAS. */
export function validateTransition(input: CompareAndSetInput, current: ModeRow | null): void {
  const { owner, next, event } = input
  if (
    next.namespace !== owner.namespace ||
    next.actorId !== owner.actorId ||
    next.actorIncarnation !== owner.actorIncarnation ||
    event.namespace !== owner.namespace ||
    event.actorId !== owner.actorId ||
    event.actorIncarnation !== owner.actorIncarnation ||
    event.revision !== next.revision ||
    event.modeId !== next.modeId ||
    event.id !== next.lastTransitionId ||
    event.at !== next.updatedAt ||
    // Every committed transition advances the revision by exactly one from the expected value.
    next.revision !== (input.expected ?? 0) + 1 ||
    // A start produces an active row; every other transition kind produces an idle row.
    (next.state === 'active') !== (event.kind === 'started') ||
    !['started', 'stopped', 'expired', 'invalidated'].includes(event.kind) ||
    (event.kind === 'started' && (event.reason ?? null) !== next.reason)
  )
    throw unavailable()

  const projected = next.state === 'active' ? next : current?.state === 'active' ? current : null
  if (event.access !== projected?.access) throw unavailable()
  if (
    projected &&
    (event.targetId !== projected.targetId ||
      event.targetIncarnation !== projected.targetIncarnation)
  )
    throw unavailable()
}
