import { test } from '@japa/runner'
import type { AuditEvent, CompareAndSetInput, ControlStore, ObserverEvent } from '../src/types.ts'
import type { LucidControlStore } from '../src/stores/lucid.ts'
import type { MemoryControlStore } from '../src/testing/memory_control_store.ts'

test('store and observer types restrict the permitted event kinds', ({ expectTypeOf }) => {
  // Type assertions below intentionally include calls that must fail compilation.
  const compileCases = () => {
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

    const controlStore = null as unknown as ControlStore
    const memoryControlStore = null as unknown as MemoryControlStore
    const lucidControlStore = null as unknown as LucidControlStore

    // @ts-expect-error Control outcomes cannot be recorded as transitions.
    controlStore.recordControlOutcome({ ...outcome, kind: 'started' })
    // @ts-expect-error The concrete memory store exposes the same narrowed public boundary.
    memoryControlStore.recordControlOutcome({ ...outcome, kind: 'started' })
    // @ts-expect-error The concrete Lucid store exposes the same narrowed public boundary.
    lucidControlStore.recordControlOutcome({ ...outcome, kind: 'started' })

    const owner = null as unknown as CompareAndSetInput['owner']
    const next = null as unknown as CompareAndSetInput['next']
    const invalidCompareAndSet: CompareAndSetInput = {
      owner,
      expected: null,
      next,
      // @ts-expect-error Compare-and-set commits transitions only.
      event: outcome,
    }

    void [deniedObserverEvent, invalidCompareAndSet]
  }
  expectTypeOf(compileCases).toBeFunction()
  expectTypeOf<ObserverEvent>().not.toEqualTypeOf<AuditEvent>()
})
