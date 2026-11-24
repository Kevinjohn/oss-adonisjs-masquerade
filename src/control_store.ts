import {
  E_MASQUERADE_STORE_MISSING,
  E_MASQUERADE_TEST_STORE_FORBIDDEN,
  E_MASQUERADE_STORE_METHOD_MISSING,
  E_MASQUERADE_STORE_OPEN_FAILED,
} from './errors.js'
import type { ControlStore, RequestControlStore } from './types.js'

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
  if (!store) throw new E_MASQUERADE_STORE_MISSING()
  if (store.testOnly && environment !== 'test') throw new E_MASQUERADE_TEST_STORE_FORBIDDEN()
  const missing = required.find(
    (name) => typeof (store as Partial<ControlStore>)[name] !== 'function'
  )
  if (missing) throw new E_MASQUERADE_STORE_METHOD_MISSING(missing)
  return store as RequestControlStore & Pick<ControlStore, K>
}
