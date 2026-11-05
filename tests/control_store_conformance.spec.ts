// The exported conformance suite must reject stores that break the documented contract.
// Each broken store wraps the memory store and changes one behaviour.
import { test } from '@japa/runner'
import { assertControlStoreConformance, MemoryControlStore } from '../testing/main.js'
import type {
  CompareAndSetInput,
  ControlOutcomeEvent,
  ControlStore,
  ModeRow,
  OwnerKey,
} from '../src/types.js'

function key(owner: OwnerKey): string {
  return JSON.stringify([owner.namespace, owner.actorId, owner.actorIncarnation])
}

class DelegatingStore implements ControlStore {
  inner = new MemoryControlStore()
  read(owner: OwnerKey) {
    return this.inner.read(owner)
  }
  compareAndSet(input: CompareAndSetInput) {
    return this.inner.compareAndSet(input)
  }
  recordControlOutcome(event: ControlOutcomeEvent) {
    return this.inner.recordControlOutcome(event)
  }
  expiredBatch(input: { now: string; limit: number }) {
    return this.inner.expiredBatch(input)
  }
  activeBatch(input: { limit: number }) {
    return this.inner.activeBatch(input)
  }
  pruneEvents(input: { before: string; limit: number }) {
    return this.inner.pruneEvents(input)
  }
}

class InsertionOrderBatches extends DelegatingStore {
  #order: string[] = []
  override async compareAndSet(input: CompareAndSetInput) {
    const outcome = await super.compareAndSet(input)
    if (outcome.status === 'applied' && !this.#order.includes(key(input.owner)))
      this.#order.push(key(input.owner))
    return outcome
  }
  #reorder(rows: ModeRow[], limit: number): ModeRow[] {
    return rows
      .sort((a, b) => this.#order.indexOf(key(a)) - this.#order.indexOf(key(b)))
      .slice(0, limit)
  }
  override async expiredBatch(input: { now: string; limit: number }) {
    return this.#reorder(await super.expiredBatch({ ...input, limit: 1000 }), input.limit)
  }
  override async activeBatch(input: { limit: number }) {
    return this.#reorder(await super.activeBatch({ limit: 1000 }), input.limit)
  }
}

class OutcomeCreatesRow extends DelegatingStore {
  override async recordControlOutcome(event: ControlOutcomeEvent) {
    await super.recordControlOutcome(event)
    if ((await this.read(event)) !== null) return
    await super.compareAndSet({
      owner: event,
      expected: null,
      next: {
        namespace: event.namespace,
        actorId: event.actorId,
        actorIncarnation: event.actorIncarnation,
        revision: 1,
        revisionNonce: 'a'.repeat(32),
        modeId: event.id,
        lastTransitionId: event.id,
        updatedAt: event.at,
        state: 'idle',
        access: null,
        targetId: null,
        targetIncarnation: null,
        actorStampHash: null,
        targetStampHash: null,
        reason: null,
        startedAt: null,
        expiresAt: null,
      },
      event: { ...event, modeId: event.id, kind: 'stopped', revision: 1 },
    })
  }
}

class KeepsCallerRow extends DelegatingStore {
  #rows = new Map<string, ModeRow>()
  override async compareAndSet(input: CompareAndSetInput) {
    const outcome = await super.compareAndSet(input)
    if (outcome.status === 'applied') this.#rows.set(key(input.owner), input.next)
    return outcome
  }
  override async read(owner: OwnerKey) {
    await super.read(owner)
    const row = this.#rows.get(key(owner))
    return row ? { ...row } : null
  }
}

class AcceptsTransitionOutcome extends DelegatingStore {
  override async recordControlOutcome(event: ControlOutcomeEvent) {
    await super.recordControlOutcome(event).catch(() => {})
  }
}

for (const [name, Store] of [
  ['batches in insertion order', InsertionOrderBatches],
  ['a control outcome that creates a row', OutcomeCreatesRow],
  ["a row kept by the caller's reference", KeepsCallerRow],
  ['a transition kind recorded as a control outcome', AcceptsTransitionOutcome],
] as const)
  test(`conformance rejects a store with ${name}`, async ({ assert }) => {
    await assertControlStoreConformance(async () => new DelegatingStore())
    await assert.rejects(() => assertControlStoreConformance(async () => new Store()))
  })
