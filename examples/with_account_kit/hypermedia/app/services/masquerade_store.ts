import db from '@adonisjs/lucid/services/db'
import type { ControlStore } from '@kevinjohn/adonisjs-masquerade/types'
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid'

/**
 * Masquerade's Lucid store on the default connection as it is at each call. Masquerade builds
 * its store once at boot, and `tests/bootstrap.ts` moves the default connection to the test
 * database after boot, so a store holding the boot connection would use a closed one.
 */
function store() {
  return new LucidControlStore(db.connection())
}

export const masqueradeStore: ControlStore = {
  read: (owner) => store().read(owner),
  compareAndSet: (input) => store().compareAndSet(input),
  recordControlOutcome: (event) => store().recordControlOutcome(event),
  expiredBatch: (input) => store().expiredBatch(input),
  activeBatch: (input) => store().activeBatch(input),
  pruneEvents: (input) => store().pruneEvents(input),
}
