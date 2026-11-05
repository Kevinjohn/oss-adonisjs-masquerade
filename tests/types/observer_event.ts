import type {
  AuditEvent,
  CompareAndSetInput,
  ControlStore,
  ObserverEvent,
} from '../../src/types.js'
import type { LucidControlStore } from '../../stores/lucid.js'
import type { MemoryControlStore } from '../../testing/memory_control_store.js'

const outcome: AuditEvent = {
  namespace: 'users',
  actorId: '1',
  actorIncarnation: 'incarnation',
  id: 'event',
  at: '2025-01-01T00:00:00.000Z',
  kind: 'start_denied',
  outcomeCode: 'denied',
  revision: 0,
}

// @ts-expect-error Observer events include transitions only.
const deniedObserverEvent: ObserverEvent = { ...outcome }

declare const controlStore: ControlStore
declare const memoryControlStore: MemoryControlStore
declare const lucidControlStore: LucidControlStore

// @ts-expect-error Control outcomes cannot be recorded as transitions.
controlStore.recordControlOutcome({ ...outcome, kind: 'started' })
// @ts-expect-error The concrete memory store exposes the same narrowed public boundary.
memoryControlStore.recordControlOutcome({ ...outcome, kind: 'started' })
// @ts-expect-error The concrete Lucid store exposes the same narrowed public boundary.
lucidControlStore.recordControlOutcome({ ...outcome, kind: 'started' })

declare const owner: CompareAndSetInput['owner']
declare const next: CompareAndSetInput['next']
const invalidCompareAndSet: CompareAndSetInput = {
  owner,
  expected: null,
  next,
  // @ts-expect-error Compare-and-set commits transitions only.
  event: outcome,
}

void [deniedObserverEvent, invalidCompareAndSet]
