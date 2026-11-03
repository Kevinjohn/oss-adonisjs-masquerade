import type { ControlStore } from '@kevinjohn/adonisjs-masquerade/types'
import type { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'

let modeReads = 0
let storeUnavailable = false

export class FixtureControlStore implements ControlStore {
  constructor(private readonly store: LucidControlStore) {}

  async read(owner: Parameters<ControlStore['read']>[0]) {
    modeReads += 1
    if (storeUnavailable) throw new Error('fixture store unavailable')
    return this.store.read(owner)
  }

  async compareAndSet(input: Parameters<ControlStore['compareAndSet']>[0]) {
    if (storeUnavailable) throw new Error('fixture store unavailable')
    return this.store.compareAndSet(input)
  }

  async recordControlOutcome(event: Parameters<ControlStore['recordControlOutcome']>[0]) {
    if (storeUnavailable) throw new Error('fixture store unavailable')
    return this.store.recordControlOutcome(event)
  }

  async expiredBatch(input: Parameters<ControlStore['expiredBatch']>[0]) {
    if (storeUnavailable) throw new Error('fixture store unavailable')
    return this.store.expiredBatch(input)
  }

  async activeBatch(input: Parameters<ControlStore['activeBatch']>[0]) {
    if (storeUnavailable) throw new Error('fixture store unavailable')
    return this.store.activeBatch(input)
  }

  async pruneEvents(input: Parameters<ControlStore['pruneEvents']>[0]) {
    if (storeUnavailable) throw new Error('fixture store unavailable')
    return this.store.pruneEvents(input)
  }
}

export function resetMasqueradeFixtureDiagnostics() {
  modeReads = 0
  storeUnavailable = false
}

export function resetMasqueradeReadCount() {
  modeReads = 0
}

export function masqueradeFixtureDiagnostics() {
  return { modeReads, storeUnavailable }
}

export function setMasqueradeStoreUnavailable(value: boolean) {
  storeUnavailable = value
}
