import {
  E_MASQUERADE_INVALID_INPUT,
  E_MASQUERADE_STOP_PROGRESS,
  E_MASQUERADE_UNAVAILABLE,
  E_MASQUERADE_UNKNOWN_ACTOR_ACCOUNT,
} from './errors.ts'
import { randomUUID } from 'node:crypto'
import { isBoundedString } from './bounded_string.ts'
import { commitTransition, createIdleRowAfterTransition } from './mode_transition.ts'
import { requireValidModeRow } from './row_validation.ts'
import { requireActiveCandidate, openOperatorStore } from './active_modes.ts'
import type { ObserverDependencies } from './observers.ts'
import type {
  ActiveModeRow,
  RequestControlStore,
  MasqueradeConfig,
  ModeRow,
  NativeAuthority,
  OwnerKey,
  TransitionEvent,
} from './types.ts'

/** Outcome code of an invalidation requested through `masquerade:stop`. */
export const OPERATOR_STOP_OUTCOME = 'operator_stopped'
export const DEFAULT_STOP_BATCH_SIZE = 100
const CONFLICT_RETRIES = 3

export interface StopModesDependencies extends ObserverDependencies {
  environment: string
  clock?: () => Date
}

export type StopModesSelection =
  { actorId: string; actorIncarnation?: string } | { all: true; batchSize?: number }

export interface StopModesResult {
  stopped: number
  /** Whether an `all` scan reached an empty batch. Omitted for a single-actor stop. */
  drained?: boolean
}

export type StopPhase = 'active_batch' | 'candidate' | 'read' | 'stop_commit'

function readCurrentTimestamp(dependencies: StopModesDependencies): string {
  try {
    const value = (dependencies.clock ?? (() => new Date()))()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw new E_MASQUERADE_UNAVAILABLE()
    const instant = value.toISOString()
    // Instants compare as text, which holds only for four-digit years.
    if (!/^\d{4}-/.test(instant)) throw new E_MASQUERADE_UNAVAILABLE()
    return instant
  } catch {
    throw new E_MASQUERADE_UNAVAILABLE()
  }
}

/**
 * Clear one active snapshot through CAS; a conflict means another transition won. A mode already
 * past its deadline is recorded as `expired`, as admission and prune record it.
 */
async function invalidate(
  store: RequestControlStore,
  dependencies: StopModesDependencies,
  current: ActiveModeRow,
  at: string
): Promise<'applied' | 'expired' | 'conflict'> {
  const lapsed = at >= current.expiresAt
  const owner: OwnerKey = {
    namespace: current.namespace,
    actorId: current.actorId,
    actorIncarnation: current.actorIncarnation,
  }
  const event: TransitionEvent = {
    ...owner,
    id: randomUUID(),
    modeId: current.modeId,
    targetId: current.targetId,
    targetIncarnation: current.targetIncarnation,
    access: current.access,
    at,
    kind: lapsed ? 'expired' : 'invalidated',
    outcomeCode: lapsed ? 'expired' : OPERATOR_STOP_OUTCOME,
    revision: current.revision + 1,
  }
  const outcome = await commitTransition(store, dependencies, {
    owner,
    expected: current.revision,
    next: createIdleRowAfterTransition(current, event),
    event,
  })
  return outcome === 'applied' && lapsed ? 'expired' : outcome
}

async function read(store: RequestControlStore, owner: OwnerKey): Promise<ModeRow | null> {
  try {
    return requireValidModeRow(await store.read(owner), owner)
  } catch {
    throw new E_MASQUERADE_UNAVAILABLE()
  }
}

async function resolveIncarnation<User, Request>(
  config: MasqueradeConfig<User, Request, RequestControlStore> & {
    authority: NativeAuthority<User>
  },
  actorId: string,
  actorIncarnation: string | undefined
): Promise<string> {
  if (actorIncarnation !== undefined) return actorIncarnation
  if (config.authority.incarnation === 'id') return actorId
  let snapshot
  try {
    snapshot = await config.authority.inspectAccount(actorId)
  } catch {
    throw new E_MASQUERADE_UNAVAILABLE()
  }
  // A deleted or reused account has no current incarnation; the operator names the row's.
  if (!snapshot || snapshot.subject.id !== actorId) throw new E_MASQUERADE_UNKNOWN_ACTOR_ACCOUNT()
  return snapshot.subject.incarnation
}

/**
 * End active modes from the server without reading security stamps. Each stop re-reads the row,
 * commits an `invalidated` event through CAS and leaves the operator's next request idle.
 */
export async function stopActiveModes<User, Request>(
  config: MasqueradeConfig<User, Request, RequestControlStore> & {
    authority: NativeAuthority<User>
  },
  dependencies: StopModesDependencies,
  selection: StopModesSelection
): Promise<StopModesResult> {
  const store = await openOperatorStore(config, dependencies.environment, [
    'read',
    'compareAndSet',
    'activeBatch',
  ])
  if ('actorId' in selection) {
    // Bound the operator's input before it reaches the host authority.
    if (!isBoundedString(selection.actorId, 255)) throw new E_MASQUERADE_INVALID_INPUT()
    const actorIncarnation = await resolveIncarnation(
      config,
      selection.actorId,
      selection.actorIncarnation
    )
    if (!isBoundedString(actorIncarnation, 128)) throw new E_MASQUERADE_INVALID_INPUT()
    const owner = {
      namespace: config.authority.namespace,
      actorId: selection.actorId,
      actorIncarnation,
    }
    for (let attempt = 0; attempt < CONFLICT_RETRIES; attempt++) {
      const current = await read(store, owner)
      if (current?.state !== 'active') return { stopped: 0 }
      const outcome = await invalidate(
        store,
        dependencies,
        current,
        readCurrentTimestamp(dependencies)
      )
      if (outcome !== 'conflict') return { stopped: outcome === 'applied' ? 1 : 0 }
    }
    throw new E_MASQUERADE_UNAVAILABLE()
  }

  const batchSize = selection.batchSize ?? DEFAULT_STOP_BATCH_SIZE
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new E_MASQUERADE_UNAVAILABLE()
  let stoppedCount = 0
  for (;;) {
    let candidates: ModeRow[]
    try {
      candidates = await store.activeBatch({ limit: batchSize })
      if (!Array.isArray(candidates) || candidates.length > batchSize)
        throw new E_MASQUERADE_UNAVAILABLE()
    } catch (error) {
      throw new E_MASQUERADE_STOP_PROGRESS('active_batch', stoppedCount, error)
    }
    if (candidates.length === 0) return { stopped: stoppedCount, drained: true }
    let progressed = false
    for (const candidate of candidates) {
      let row: ActiveModeRow
      try {
        row = requireActiveCandidate(candidate)
      } catch (error) {
        throw new E_MASQUERADE_STOP_PROGRESS('candidate', stoppedCount, error)
      }
      let current: ModeRow | null
      try {
        current = requireValidModeRow(await store.read(row), row)
      } catch (error) {
        throw new E_MASQUERADE_STOP_PROGRESS('read', stoppedCount, error)
      }
      if (current?.state !== 'active' || current.revision !== row.revision) continue
      let outcome
      try {
        outcome = await invalidate(store, dependencies, current, readCurrentTimestamp(dependencies))
      } catch (error) {
        throw new E_MASQUERADE_STOP_PROGRESS('stop_commit', stoppedCount, error)
      }
      if (outcome === 'applied') stoppedCount++
      if (outcome !== 'conflict') progressed = true
    }
    // An empty batch is done; a batch that only conflicted is left for the next run.
    if (!progressed) return { stopped: stoppedCount, drained: false }
  }
}
