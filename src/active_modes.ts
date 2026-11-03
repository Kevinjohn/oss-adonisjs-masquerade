import { defineConfig } from './define_config.js'
import { unavailable } from './error_helpers.js'
import { boundedString } from './bounded_string.js'
import { openControlStore } from './control_store.js'
import { validateRow } from './row_validation.js'
import type { ActiveModeRow, ControlStore, MasqueradeConfig, ModeRow, OwnerKey } from './types.js'

export const DEFAULT_ACTIVE_MODE_LIMIT = 50
export const MAX_ACTIVE_MODE_LIMIT = 1000

/** One active mode as shown to an operator; the start reason stays in the audit ledger. */
export type ActiveModeSummary = Readonly<
  Pick<
    ActiveModeRow,
    | 'namespace'
    | 'actorId'
    | 'actorIncarnation'
    | 'targetId'
    | 'access'
    | 'startedAt'
    | 'expiresAt'
    | 'revision'
  >
>

/** Validate one store batch candidate as an active row for its own owner key. */
export function activeCandidate(candidate: ModeRow): ActiveModeRow {
  try {
    const owner: OwnerKey = {
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
    const row = validateRow(candidate, owner)
    if (row?.state !== 'active') throw unavailable()
    return row
  } catch {
    throw unavailable()
  }
}

export async function openOperatorStore<User, Request>(
  config: MasqueradeConfig<User, Request>,
  environment: string,
  required: readonly (keyof ControlStore)[]
): Promise<ControlStore> {
  const validated = defineConfig(config)
  try {
    return await openControlStore(validated.store, environment, required)
  } catch {
    throw unavailable()
  }
}

/** Read at most limit active modes visible through the configured store, oldest update first. */
export async function listActiveModes<User, Request>(
  config: MasqueradeConfig<User, Request>,
  dependencies: { environment: string },
  options: { limit?: number } = {}
): Promise<ActiveModeSummary[]> {
  const limit = options.limit ?? DEFAULT_ACTIVE_MODE_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ACTIVE_MODE_LIMIT)
    throw unavailable()
  const store = await openOperatorStore(config, dependencies.environment, ['activeBatch'])
  let candidates: ModeRow[]
  try {
    candidates = await store.activeBatch({ limit })
    if (!Array.isArray(candidates) || candidates.length > limit) throw unavailable()
  } catch {
    throw unavailable()
  }
  return candidates.map((candidate) => {
    const row = activeCandidate(candidate)
    return {
      namespace: row.namespace,
      actorId: row.actorId,
      actorIncarnation: row.actorIncarnation,
      targetId: row.targetId,
      access: row.access,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      revision: row.revision,
    }
  })
}
