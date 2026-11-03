import { MasqueradeSetupError } from './errors.js'
import { unavailable } from './error_helpers.js'
import type { MasqueradeSetupErrorField } from './errors.js'
import type { ControlStore } from './types.js'

const storeErrorFields: Record<keyof ControlStore, MasqueradeSetupErrorField> = {
  testOnly: 'store.testOnly',
  read: 'store.read',
  compareAndSet: 'store.compareAndSet',
  recordControlOutcome: 'store.recordControlOutcome',
  expiredBatch: 'store.expiredBatch',
  activeBatch: 'store.activeBatch',
  pruneEvents: 'store.pruneEvents',
}

/** Resolve the host store and validate the capabilities needed by its caller. */
export async function openControlStore(
  factory: () => Promise<ControlStore>,
  environment: string,
  required: readonly (keyof ControlStore)[]
): Promise<ControlStore> {
  let store: ControlStore
  try {
    store = await factory()
  } catch {
    throw unavailable()
  }
  if (!store) throw new MasqueradeSetupError('E_MASQUERADE_INVALID_STORE', 'store')
  if (store.testOnly && environment !== 'test')
    throw new MasqueradeSetupError('E_MASQUERADE_INVALID_STORE', 'store.testOnly')
  const missing = required.find((name) => typeof store[name] !== 'function')
  if (missing)
    throw new MasqueradeSetupError('E_MASQUERADE_INVALID_STORE', storeErrorFields[missing])
  return store
}
