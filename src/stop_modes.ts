import { randomUUID } from 'node:crypto'
import { MasqueradeError } from './errors.js'
import { unavailable } from './error_helpers.js'
import { boundedString } from './bounded_string.js'
import { commitTransition, idleAfterTransition } from './mode_transition.js'
import { validateRow } from './row_validation.js'
import { activeCandidate, openOperatorStore } from './active_modes.js'
import type { ObserverDependencies } from './observers.js'
import type {
  ActiveModeRow,
  ControlStore,
  MasqueradeConfig,
  ModeRow,
  OwnerKey,
  TransitionEvent,
} from './types.js'

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
}

function now(dependencies: StopModesDependencies): string {
  try {
    const value = (dependencies.clock ?? (() => new Date()))()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable()
    const instant = value.toISOString()
    // Instants compare as text, which holds only for four-digit years.
    if (!/^\d{4}-/.test(instant)) throw unavailable()
    return instant
  } catch {
    throw unavailable()
  }
}

/**
 * Clear one active snapshot through CAS; a conflict means another transition won. A mode already
 * past its deadline is recorded as `expired`, as admission and prune record it.
 */
async function invalidate(
  store: ControlStore,
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
    next: idleAfterTransition(current, event),
    event,
  })
  return outcome === 'applied' && lapsed ? 'expired' : outcome
}

async function read(store: ControlStore, owner: OwnerKey): Promise<ModeRow | null> {
  try {
    return validateRow(await store.read(owner), owner)
  } catch {
    throw unavailable()
  }
}

async function resolveIncarnation<User, Request>(
  config: MasqueradeConfig<User, Request>,
  actorId: string,
  actorIncarnation: string | undefined
): Promise<string> {
  if (actorIncarnation !== undefined) return actorIncarnation
  if (config.authority.incarnation === 'id') return actorId
  let snapshot
  try {
    snapshot = await config.authority.inspectAccount(actorId)
  } catch {
    throw unavailable()
  }
  // A deleted or reused account has no current incarnation; the operator names the row's.
  if (!snapshot || snapshot.subject.id !== actorId)
    throw new MasqueradeError('E_MASQUERADE_INVALID_INPUT')
  return snapshot.subject.incarnation
}

/**
 * End active modes from the server without reading security stamps. Each stop re-reads the row,
 * commits an `invalidated` event through CAS and leaves the operator's next request idle.
 */
export async function stopActiveModes<User, Request>(
  config: MasqueradeConfig<User, Request>,
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
    if (!boundedString(selection.actorId, 255))
      throw new MasqueradeError('E_MASQUERADE_INVALID_INPUT')
    const actorIncarnation = await resolveIncarnation(
      config,
      selection.actorId,
      selection.actorIncarnation
    )
    if (!boundedString(actorIncarnation, 128))
      throw new MasqueradeError('E_MASQUERADE_INVALID_INPUT')
    const owner = {
      namespace: config.authority.namespace,
      actorId: selection.actorId,
      actorIncarnation,
    }
    for (let attempt = 0; attempt < CONFLICT_RETRIES; attempt++) {
      const current = await read(store, owner)
      if (current?.state !== 'active') return { stopped: 0 }
      const outcome = await invalidate(store, dependencies, current, now(dependencies))
      if (outcome !== 'conflict') return { stopped: outcome === 'applied' ? 1 : 0 }
    }
    throw unavailable()
  }

  const batchSize = selection.batchSize ?? DEFAULT_STOP_BATCH_SIZE
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw unavailable()
  let stopped = 0
  for (;;) {
    let candidates: ModeRow[]
    try {
      candidates = await store.activeBatch({ limit: batchSize })
      if (!Array.isArray(candidates) || candidates.length > batchSize) throw unavailable()
    } catch {
      throw unavailable()
    }
    let progressed = false
    for (const candidate of candidates) {
      const row = activeCandidate(candidate)
      const current = await read(store, row)
      if (current?.state !== 'active' || current.revision !== row.revision) continue
      const outcome = await invalidate(store, dependencies, current, now(dependencies))
      if (outcome === 'applied') stopped++
      if (outcome !== 'conflict') progressed = true
    }
    // An empty batch is done; a batch that only conflicted is left for the next run.
    if (!progressed) return { stopped }
  }
}
