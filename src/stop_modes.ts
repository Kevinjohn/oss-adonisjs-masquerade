import { randomUUID } from 'node:crypto'
import { MasqueradeError } from './errors.js'
import { createUnavailableError } from './error_helpers.js'
import { isBoundedString } from './bounded_string.js'
import { commitTransition, idleAfterTransition, UnknownCommit } from './mode_transition.js'
import { requireValidModeRow } from './row_validation.js'
import { requireActiveCandidate, openOperatorStore } from './active_modes.js'
import type { ObserverDependencies } from './observers.js'
import type {
  ActiveModeRow,
  RequestControlStore,
  MasqueradeConfig,
  ModeRow,
  NativeAuthority,
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
  /** Whether an `all` scan reached an empty batch. Omitted for a single-actor stop. */
  drained?: boolean
}

type StopPhase = 'active_batch' | 'candidate' | 'read' | 'stop_commit'

/** Progress confirmed before a bulk stop failed. */
export class StopProgressError extends MasqueradeError {
  constructor(
    readonly phase: StopPhase,
    readonly stopped: number,
    override readonly cause: unknown
  ) {
    super('E_MASQUERADE_UNAVAILABLE')
    this.name = 'StopProgressError'
  }

  get indeterminate(): boolean {
    return this.phase === 'stop_commit' && this.cause instanceof UnknownCommit
  }
}

function now(dependencies: StopModesDependencies): string {
  try {
    const value = (dependencies.clock ?? (() => new Date()))()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw createUnavailableError()
    const instant = value.toISOString()
    // Instants compare as text, which holds only for four-digit years.
    if (!/^\d{4}-/.test(instant)) throw createUnavailableError()
    return instant
  } catch {
    throw createUnavailableError()
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
    next: idleAfterTransition(current, event),
    event,
  })
  return outcome === 'applied' && lapsed ? 'expired' : outcome
}

async function read(store: RequestControlStore, owner: OwnerKey): Promise<ModeRow | null> {
  try {
    return requireValidModeRow(await store.read(owner), owner)
  } catch {
    throw createUnavailableError()
  }
}

/** Errors thrown because the authority has no current account for the actor, not bad input. */
const unknownAccounts = new WeakSet<MasqueradeError>()

/** Whether `stopActiveModes` threw because the actor's account could not be found. */
export function isUnknownAccount(error: unknown): boolean {
  return error instanceof MasqueradeError && unknownAccounts.has(error)
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
    throw createUnavailableError()
  }
  // A deleted or reused account has no current incarnation; the operator names the row's.
  if (!snapshot || snapshot.subject.id !== actorId) {
    const error = new MasqueradeError('E_MASQUERADE_INVALID_INPUT')
    unknownAccounts.add(error)
    throw error
  }
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
    if (!isBoundedString(selection.actorId, 255))
      throw new MasqueradeError('E_MASQUERADE_INVALID_INPUT')
    const actorIncarnation = await resolveIncarnation(
      config,
      selection.actorId,
      selection.actorIncarnation
    )
    if (!isBoundedString(actorIncarnation, 128))
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
    throw createUnavailableError()
  }

  const batchSize = selection.batchSize ?? DEFAULT_STOP_BATCH_SIZE
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw createUnavailableError()
  let stoppedCount = 0
  for (;;) {
    let candidates: ModeRow[]
    try {
      candidates = await store.activeBatch({ limit: batchSize })
      if (!Array.isArray(candidates) || candidates.length > batchSize)
        throw createUnavailableError()
    } catch (error) {
      throw new StopProgressError('active_batch', stoppedCount, error)
    }
    if (candidates.length === 0) return { stopped: stoppedCount, drained: true }
    let progressed = false
    for (const candidate of candidates) {
      let row: ActiveModeRow
      try {
        row = requireActiveCandidate(candidate)
      } catch (error) {
        throw new StopProgressError('candidate', stoppedCount, error)
      }
      let current: ModeRow | null
      try {
        current = requireValidModeRow(await store.read(row), row)
      } catch (error) {
        throw new StopProgressError('read', stoppedCount, error)
      }
      if (current?.state !== 'active' || current.revision !== row.revision) continue
      let outcome
      try {
        outcome = await invalidate(store, dependencies, current, now(dependencies))
      } catch (error) {
        throw new StopProgressError('stop_commit', stoppedCount, error)
      }
      if (outcome === 'applied') stoppedCount++
      if (outcome !== 'conflict') progressed = true
    }
    // An empty batch is done; a batch that only conflicted is left for the next run.
    if (!progressed) return { stopped: stoppedCount, drained: false }
  }
}
