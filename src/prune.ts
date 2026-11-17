import { randomUUID } from 'node:crypto'
import { MasqueradeError } from './errors.js'
import { defineConfig } from './define_config.js'
import { unavailable } from './error_helpers.js'
import { openControlStore } from './control_store.js'
import { activeCandidate } from './active_modes.js'
import { commitTransition, idleAfterTransition, UnknownCommit } from './mode_transition.js'
import { validateRow } from './row_validation.js'
import type { ObserverDependencies } from './observers.js'
import type { MasqueradeConfig, ModeRow, RequestControlStore, TransitionEvent } from './types.js'

export const DEFAULT_PRUNE_BATCH_SIZE = 100
export const MAX_PRUNE_BATCH_SIZE = 1000

export interface PruneDependencies extends ObserverDependencies {
  environment: string
  clock?: () => Date
}

export interface PruneOptions {
  batchSize?: number
  now?: Date
}

export interface PruneResult {
  expired: number
  eventsDeleted: number
}

export type PrunePhase =
  'event_retention' | 'expired_batch' | 'candidate' | 'read' | 'expiry_commit'

/** Counts are confirmed completed operations; an uncertain commit is identified separately. */
export class PruneProgressError extends MasqueradeError {
  constructor(
    readonly phase: PrunePhase,
    readonly completed: PruneResult,
    readonly indeterminate: boolean = false
  ) {
    super('E_MASQUERADE_UNAVAILABLE')
    this.name = 'PruneProgressError'
  }
}

function resolveNow(options: PruneOptions, dependencies: PruneDependencies): Date {
  try {
    const value = options.now ?? (dependencies.clock ?? (() => new Date()))()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable()
    // Instants compare as text, which holds only for four-digit years.
    if (!/^\d{4}-/.test(value.toISOString())) throw unavailable()
    return new Date(value.getTime())
  } catch {
    throw unavailable()
  }
}

/**
 * Process one bounded housekeeping pass: event retention, then expiry, which is re-read and
 * guarded by CAS per owner.
 * Retention applies to every namespace visible through this store; use a scoped store when
 * namespaces need different retention policies.
 */
export async function pruneMasquerade<User, Request>(
  config: MasqueradeConfig<User, Request, RequestControlStore>,
  dependencies: PruneDependencies,
  options: PruneOptions = {}
): Promise<PruneResult> {
  const batchSize = options.batchSize ?? DEFAULT_PRUNE_BATCH_SIZE
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_PRUNE_BATCH_SIZE)
    throw unavailable()

  const now = resolveNow(options, dependencies).toISOString()
  const validated = defineConfig(config)
  const store = await openControlStore(validated.store, dependencies.environment, [
    'read',
    'compareAndSet',
    'expiredBatch',
    'pruneEvents',
  ])

  // Event retention runs first, so a row that blocks expiry never blocks retention.
  let eventsDeleted = 0
  let expired = 0
  const failed = (phase: PrunePhase, indeterminate = false): never => {
    throw new PruneProgressError(phase, { expired, eventsDeleted }, indeterminate)
  }
  if (validated.retention !== 'host-managed') {
    const before = new Date(Date.parse(now) - validated.retention.days * 86_400_000)
    if (!Number.isFinite(before.getTime())) throw unavailable()
    try {
      const deleted = await store.pruneEvents({ before: before.toISOString(), limit: batchSize })
      if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > batchSize) throw unavailable()
      eventsDeleted = deleted
    } catch {
      return failed('event_retention', true)
    }
  }
  let candidates: ModeRow[]
  try {
    candidates = await store.expiredBatch({ now, limit: batchSize })
    if (!Array.isArray(candidates) || candidates.length > batchSize) throw unavailable()
  } catch {
    return failed('expired_batch')
  }

  for (const candidate of candidates) {
    let candidateRow
    try {
      candidateRow = activeCandidate(candidate)
    } catch {
      return failed('candidate')
    }
    const owner = {
      namespace: candidateRow.namespace,
      actorId: candidateRow.actorId,
      actorIncarnation: candidateRow.actorIncarnation,
    }
    let current: ModeRow | null
    try {
      current = validateRow(await store.read(owner), owner)
    } catch {
      return failed('read')
    }
    if (
      current?.state !== 'active' ||
      current.revision !== candidateRow.revision ||
      current.expiresAt !== candidateRow.expiresAt ||
      current.expiresAt > now
    )
      continue

    const id = randomUUID()
    const event: TransitionEvent = {
      ...owner,
      id,
      modeId: current.modeId,
      targetId: current.targetId,
      targetIncarnation: current.targetIncarnation,
      access: current.access,
      at: now,
      kind: 'expired',
      outcomeCode: 'expired',
      revision: current.revision + 1,
    }
    let next
    try {
      next = idleAfterTransition(current, event)
    } catch {
      return failed('expiry_commit')
    }
    try {
      const outcome = await commitTransition(store, dependencies, {
        owner,
        expected: current.revision,
        next,
        event,
      })
      if (outcome === 'conflict') continue
    } catch (error) {
      return failed('expiry_commit', error instanceof UnknownCommit)
    }
    expired++
  }

  return { expired, eventsDeleted }
}
