import { E_MASQUERADE_UNAVAILABLE } from './errors.ts'
import { validateConfig } from './define_config.ts'
import { isBoundedString } from './bounded_string.ts'
import { openControlStore } from './control_store.ts'
import { requireValidModeRow } from './row_validation.ts'
import type {
  ActiveModeRow,
  ControlStore,
  MasqueradeConfig,
  ModeRow,
  OwnerKey,
  RequestControlStore,
} from './types.ts'

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
      throw new E_MASQUERADE_UNAVAILABLE()
    const row = requireValidModeRow(candidate, owner)
    if (row?.state !== 'active') throw new E_MASQUERADE_UNAVAILABLE()
    return row
  } catch {
    throw new E_MASQUERADE_UNAVAILABLE()
  }
}

export async function openOperatorStore<User, Request, K extends keyof ControlStore>(
  config: MasqueradeConfig<User, Request, RequestControlStore>,
  environment: string,
  required: readonly K[]
): Promise<RequestControlStore & Pick<ControlStore, K>> {
  const validated = validateConfig(config)
  try {
    return await openControlStore(validated.store, environment, required)
  } catch {
    throw new E_MASQUERADE_UNAVAILABLE()
  }
}

/** Read at most limit active modes visible through the configured store, oldest update first. */
export async function listActiveModes<User, Request>(
  config: MasqueradeConfig<User, Request, RequestControlStore>,
  dependencies: { environment: string },
  options: { limit?: number } = {}
): Promise<ActiveModeSummary[]> {
  const limit = options.limit ?? DEFAULT_ACTIVE_MODE_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ACTIVE_MODE_LIMIT)
    throw new E_MASQUERADE_UNAVAILABLE()
  const store = await openOperatorStore(config, dependencies.environment, ['activeBatch'])
  let candidates: ModeRow[]
  try {
    candidates = await store.activeBatch({ limit })
    if (!Array.isArray(candidates) || candidates.length > limit)
      throw new E_MASQUERADE_UNAVAILABLE()
  } catch {
    throw new E_MASQUERADE_UNAVAILABLE()
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
