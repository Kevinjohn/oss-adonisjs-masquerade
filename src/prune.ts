import { randomUUID } from 'node:crypto'
import { defineConfig } from './define_config.js'
import { unavailable } from './error_helpers.js'
import { boundedString } from './bounded_string.js'
import { openControlStore } from './control_store.js'
import { commitTransition, idleAfterTransition } from './mode_transition.js'
import { validateRow } from './row_validation.js'
import type { ObserverDependencies } from './observers.js'
import type { ActiveModeRow, MasqueradeConfig, ModeRow, TransitionEvent } from './types.js'

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
  config: MasqueradeConfig<User, Request>,
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
  if (validated.retention !== 'host-managed') {
    const before = new Date(Date.parse(now) - validated.retention.days * 86_400_000)
    if (!Number.isFinite(before.getTime())) throw unavailable()
    try {
      eventsDeleted = await store.pruneEvents({ before: before.toISOString(), limit: batchSize })
      if (!Number.isSafeInteger(eventsDeleted) || eventsDeleted < 0 || eventsDeleted > batchSize)
        throw unavailable()
    } catch {
      throw unavailable()
    }
  }
  let candidates: ModeRow[]
  try {
    candidates = await store.expiredBatch({ now, limit: batchSize })
    if (!Array.isArray(candidates) || candidates.length > batchSize) throw unavailable()
  } catch {
    throw unavailable()
  }

  let expired = 0
  for (const candidate of candidates) {
    let owner: { namespace: string; actorId: string; actorIncarnation: string }
    try {
      owner = {
        namespace: candidate.namespace,
        actorId: candidate.actorId,
        actorIncarnation: candidate.actorIncarnation,
      }
      if (
        !boundedString(owner.namespace, 128) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(owner.namespace) ||
        !boundedString(owner.actorId, 255) ||
        !boundedString(owner.actorIncarnation, 128)
      )
        throw unavailable()
      const validCandidate = validateRow(candidate, owner)
      if (validCandidate?.state !== 'active') throw unavailable()
    } catch {
      throw unavailable()
    }
    const candidateRow = candidate as ActiveModeRow
    let current: ModeRow | null
    try {
      current = validateRow(await store.read(owner), owner)
    } catch {
      throw unavailable()
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
    try {
      const next = idleAfterTransition(current, event)
      const outcome = await commitTransition(store, dependencies, {
        owner,
        expected: current.revision,
        next,
        event,
      })
      if (outcome === 'conflict') continue
    } catch (error) {
      if ((error as { code?: string }).code === 'E_MASQUERADE_UNAVAILABLE') throw error
      throw unavailable()
    }
    expired++
  }

  return { expired, eventsDeleted }
}
