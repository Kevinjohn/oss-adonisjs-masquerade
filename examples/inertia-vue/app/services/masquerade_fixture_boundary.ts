import type { LucidControlStore } from 'adonisjs-masquerade/stores/lucid'
import {
  areCustomerRequestsUnavailable,
  setCustomerRequestsUnavailable,
  setMasqueradeStoreUnavailable,
  withFixtureControlStore as wrapFixtureControlStore,
} from '#services/fixture_control_store'

export {
  areCustomerRequestsUnavailable,
  setCustomerRequestsUnavailable,
  setMasqueradeStoreUnavailable,
}

export function withFixtureControlStore(store: LucidControlStore) {
  return wrapFixtureControlStore(store)
}
