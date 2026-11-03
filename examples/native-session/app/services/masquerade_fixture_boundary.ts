import type { LucidControlStore } from 'adonisjs-masquerade/stores/lucid'
import {
  FixtureControlStore,
  masqueradeFixtureDiagnostics,
  resetMasqueradeFixtureDiagnostics,
  resetMasqueradeReadCount,
  setMasqueradeStoreUnavailable,
} from '#services/fixture_control_store'

let testTime: number | undefined
let throwFromAuthorityCallbacks = false

export {
  masqueradeFixtureDiagnostics,
  resetMasqueradeFixtureDiagnostics,
  resetMasqueradeReadCount,
  setMasqueradeStoreUnavailable,
}

export function withFixtureControlStore(store: LucidControlStore) {
  return new FixtureControlStore(store)
}

export function setMasqueradeTestTime(value: number | undefined) {
  testTime = value
}

export function masqueradeNow() {
  return testTime ?? Date.now()
}

export function setAuthorityCallbacksThrow(value: boolean) {
  throwFromAuthorityCallbacks = value
}

export function shouldThrowFromAuthorityCallbacks() {
  return process.env.NODE_ENV === 'test' && throwFromAuthorityCallbacks
}
