import {
  E_MASQUERADE_MODE_ROW_INVALID,
  E_MASQUERADE_OPERATOR_INPUT_INVALID,
  E_MASQUERADE_STORE_BATCH_FAILED,
  E_MASQUERADE_STORE_BATCH_INVALID,
} from './errors.js'
import { MasqueradeRequestException } from './request_exception.js'
import { defineConfig } from './define_config.js'
import { isBoundedString } from './bounded_string.js'
import { openControlStore } from './control_store.js'
import { requireValidModeRow } from './row_validation.js'
import type {
  ActiveModeRow,
  ControlStore,
  MasqueradeConfig,
  ModeRow,
  OwnerKey,
  RequestControlStore,
} from './types.js'

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
export function requireActiveCandidate(candidate: ModeRow): ActiveModeRow {
  try {
    const owner: OwnerKey = {
      namespace: candidate.namespace,
      actorId: candidate.actorId,
      actorIncarnation: candidate.actorIncarnation,
    }
    if (
      !isBoundedString(owner.namespace, 128) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(owner.namespace) ||
      !isBoundedString(owner.actorId, 255) ||
      !isBoundedString(owner.actorIncarnation, 128)
    )
      throw new E_MASQUERADE_MODE_ROW_INVALID()
    const row = requireValidModeRow(candidate, owner)
    if (row?.state !== 'active') throw new E_MASQUERADE_MODE_ROW_INVALID()
    return row
  } catch {
    throw new E_MASQUERADE_MODE_ROW_INVALID()
  }
}

export async function openOperatorStore<User, Request, K extends keyof ControlStore>(
  config: MasqueradeConfig<User, Request, RequestControlStore>,
  environment: string,
  required: readonly K[]
): Promise<RequestControlStore & Pick<ControlStore, K>> {
  const validated = defineConfig(config)
  return openControlStore(validated.store, environment, required)
}

/** Read at most limit active modes visible through the configured store, oldest update first. */
export async function listActiveModes<User, Request>(
  config: MasqueradeConfig<User, Request, RequestControlStore>,
  dependencies: { environment: string },
  options: { limit?: number } = {}
): Promise<ActiveModeSummary[]> {
  const limit = options.limit ?? DEFAULT_ACTIVE_MODE_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ACTIVE_MODE_LIMIT)
    throw new E_MASQUERADE_OPERATOR_INPUT_INVALID()
  const store = await openOperatorStore(config, dependencies.environment, ['activeBatch'])
  let candidates: ModeRow[]
  try {
    candidates = await store.activeBatch({ limit })
    if (!Array.isArray(candidates) || candidates.length > limit)
      throw new E_MASQUERADE_STORE_BATCH_INVALID()
  } catch (error) {
    if (error instanceof MasqueradeRequestException) throw error
    throw new E_MASQUERADE_STORE_BATCH_FAILED(error)
  }
  return candidates.map((candidate) => {
    const row = requireActiveCandidate(candidate)
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
