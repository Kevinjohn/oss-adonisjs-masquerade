import {
  E_MASQUERADE_CLOCK_INVALID,
  E_MASQUERADE_OPERATOR_INPUT_INVALID,
  E_MASQUERADE_PRUNE_PROGRESS,
  E_MASQUERADE_RETENTION_CUTOFF_INVALID,
  E_MASQUERADE_STORE_BATCH_INVALID,
  E_MASQUERADE_UNKNOWN_COMMIT,
} from './errors.js'
import { randomUUID } from 'node:crypto'
import { defineConfig } from './define_config.js'
import { openControlStore } from './control_store.js'
import { requireActiveCandidate } from './active_modes.js'
import { commitTransition, createIdleRowAfterTransition } from './mode_transition.js'
import { requireValidModeRow } from './row_validation.js'
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

function resolveNow(options: PruneOptions, dependencies: PruneDependencies): Date {
  try {
    const value = options.now ?? (dependencies.clock ?? (() => new Date()))()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw new E_MASQUERADE_CLOCK_INVALID()
    // Instants compare as text, which holds only for four-digit years.
    if (!/^\d{4}-/.test(value.toISOString())) throw new E_MASQUERADE_CLOCK_INVALID()
    return new Date(value.getTime())
  } catch (error) {
    if (error instanceof E_MASQUERADE_CLOCK_INVALID) throw error
    throw new E_MASQUERADE_CLOCK_INVALID(error)
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
    throw new E_MASQUERADE_OPERATOR_INPUT_INVALID()

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
  const throwPruneFailure = (phase: PrunePhase, cause: unknown, indeterminate = false): never => {
    throw new E_MASQUERADE_PRUNE_PROGRESS(phase, { expired, eventsDeleted }, indeterminate, cause)
  }
  if (validated.retention !== 'host-managed') {
    const before = new Date(Date.parse(now) - validated.retention.days * 86_400_000)
    if (!Number.isFinite(before.getTime())) throw new E_MASQUERADE_RETENTION_CUTOFF_INVALID()
    try {
      const deleted = await store.pruneEvents({ before: before.toISOString(), limit: batchSize })
      if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > batchSize)
        throw new E_MASQUERADE_STORE_BATCH_INVALID()
      eventsDeleted = deleted
    } catch (error) {
      return throwPruneFailure('event_retention', error, true)
    }
  }
  let candidates: ModeRow[]
  try {
    candidates = await store.expiredBatch({ now, limit: batchSize })
    if (!Array.isArray(candidates) || candidates.length > batchSize)
      throw new E_MASQUERADE_STORE_BATCH_INVALID()
  } catch (error) {
    return throwPruneFailure('expired_batch', error)
  }

  for (const candidate of candidates) {
    let candidateRow
    try {
      candidateRow = requireActiveCandidate(candidate)
    } catch (error) {
      return throwPruneFailure('candidate', error)
    }
    const owner = {
      namespace: candidateRow.namespace,
      actorId: candidateRow.actorId,
      actorIncarnation: candidateRow.actorIncarnation,
    }
    let current: ModeRow | null
    try {
      current = requireValidModeRow(await store.read(owner), owner)
    } catch (error) {
      return throwPruneFailure('read', error)
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
      next = createIdleRowAfterTransition(current, event)
    } catch (error) {
      return throwPruneFailure('expiry_commit', error)
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
      return throwPruneFailure('expiry_commit', error, error instanceof E_MASQUERADE_UNKNOWN_COMMIT)
    }
    expired++
  }

  return { expired, eventsDeleted }
}
