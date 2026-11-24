import { MasqueradeRequestException } from './request_exception.js'
import {
  E_MASQUERADE_REVISION_EXHAUSTED,
  E_MASQUERADE_STORE_COMMIT_FAILED,
  E_MASQUERADE_UNKNOWN_COMMIT,
} from './errors.js'
import { randomBytes } from 'node:crypto'
import { observe, reportUnknown } from './observers.js'
import type { ObserverDependencies } from './observers.js'
import type {
  ActiveModeRow,
  AuditEvent,
  CompareAndSetInput,
  RequestControlStore,
  IdleModeRow,
  ModeRow,
} from './types.js'

export function advanceRevision(row: ModeRow | null): number {
  if (row?.revision === Number.MAX_SAFE_INTEGER) throw new E_MASQUERADE_REVISION_EXHAUSTED()
  return (row?.revision ?? 0) + 1
}

export function createIdleRowAfterTransition(row: ActiveModeRow, event: AuditEvent): IdleModeRow {
  return {
    namespace: row.namespace,
    actorId: row.actorId,
    actorIncarnation: row.actorIncarnation,
    state: 'idle',
    access: null,
    revision: advanceRevision(row),
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
  store: RequestControlStore,
  dependencies: ObserverDependencies,
  input: CompareAndSetInput
): Promise<'applied' | 'conflict'> {
  let outcome
  try {
    outcome = await store.compareAndSet(input)
  } catch (error) {
    if (error instanceof MasqueradeRequestException) throw error
    throw new E_MASQUERADE_STORE_COMMIT_FAILED(error)
  }
  if (outcome?.status === 'conflict') return 'conflict'
  if (outcome?.status !== 'applied' || outcome.transitionId !== input.event.id) {
    reportUnknown(dependencies, input.event.id)
    throw new E_MASQUERADE_UNKNOWN_COMMIT()
  }
  observe(dependencies, input.event)
  return 'applied'
}
