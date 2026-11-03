import { randomBytes } from 'node:crypto'
import { MasqueradeError } from './errors.js'
import { unavailable } from './error_helpers.js'
import { observe, reportUnknown } from './observers.js'
import type { ObserverDependencies } from './observers.js'
import type {
  ActiveModeRow,
  AuditEvent,
  CompareAndSetInput,
  ControlStore,
  IdleModeRow,
  ModeRow,
} from './types.js'

/** Keep uncertain commits distinct so callers cannot record a false denial. */
export class UnknownCommit extends MasqueradeError {
  constructor() {
    super('E_MASQUERADE_UNAVAILABLE')
  }
}

export function nextRevision(row: ModeRow | null): number {
  if (row?.revision === Number.MAX_SAFE_INTEGER) throw unavailable()
  return (row?.revision ?? 0) + 1
}

export function idleAfterTransition(row: ActiveModeRow, event: AuditEvent): IdleModeRow {
  return {
    namespace: row.namespace,
    actorId: row.actorId,
    actorIncarnation: row.actorIncarnation,
    state: 'idle',
    access: null,
    revision: nextRevision(row),
    revisionNonce: randomBytes(16).toString('hex'),
    modeId: row.modeId,
    lastTransitionId: event.id,
    updatedAt: event.at,
    targetId: null,
    targetIncarnation: null,
    actorStampHash: null,
    targetStampHash: null,
    reason: null,
    startedAt: null,
    expiresAt: null,
  }
}

/** Apply one audited transition; callers decide what a conflict means. */
export async function commitTransition(
  store: ControlStore,
  dependencies: ObserverDependencies,
  input: CompareAndSetInput
): Promise<'applied' | 'conflict'> {
  let outcome
  try {
    outcome = await store.compareAndSet(input)
  } catch {
    throw unavailable()
  }
  if (outcome?.status === 'conflict') return 'conflict'
  if (outcome?.status !== 'applied' || outcome.transitionId !== input.event.id) {
    reportUnknown(dependencies, input.event.id)
    throw new UnknownCommit()
  }
  observe(dependencies, input.event)
  return 'applied'
}
