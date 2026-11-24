import { E_MASQUERADE_INVALID_STORE, E_MASQUERADE_STORE_OPEN_FAILED } from './errors.js'
import type { MasqueradeSetupErrorField } from './errors.js'
import type { ControlStore, RequestControlStore } from './types.js'

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
export async function openControlStore<K extends keyof ControlStore>(
  factory: () => Promise<RequestControlStore>,
  environment: string,
  required: readonly K[]
): Promise<RequestControlStore & Pick<ControlStore, K>> {
  let store: RequestControlStore
  try {
    store = await factory()
  } catch (error) {
    throw new E_MASQUERADE_STORE_OPEN_FAILED(error)
  }
  if (!store) throw new E_MASQUERADE_INVALID_STORE('store')
  if (store.testOnly && environment !== 'test')
    throw new E_MASQUERADE_INVALID_STORE('store.testOnly')
  const missing = required.find(
    (name) => typeof (store as Partial<ControlStore>)[name] !== 'function'
  )
  if (missing) throw new E_MASQUERADE_INVALID_STORE(storeErrorFields[missing])
  return store as RequestControlStore & Pick<ControlStore, K>
}
