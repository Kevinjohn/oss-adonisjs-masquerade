import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  ActiveModeRow,
  ControlStore,
  IdleModeRow,
  OwnerKey,
  TransitionEvent,
} from '../types.ts'

/** Exercises the portable control store contract. */
class ControlStoreConformance {
  /**
   * Run against a fresh, isolated store. SQL connection/race and rollback tests supplement this contract.
   *
   * @example
   * ```ts
   * controlStoreConformance.assert(async () => new MemoryControlStore())
   * ```
   */
  async assert(createStore: () => Promise<ControlStore>): Promise<void> {
    const store = await createStore()
    const owner: OwnerKey = {
      namespace: 'conformance',
      actorId: randomUUID(),
      actorIncarnation: 'original',
    }
    const event: TransitionEvent = {
      ...owner,
      id: randomUUID(),
      modeId: randomUUID(),
      at: '2026-01-01T00:00:00.000Z',
      kind: 'started',
      outcomeCode: 'started',
      revision: 1,
      targetId: 'initial-target',
      targetIncarnation: 'target-v1',
      access: 'view',
      reason: 'Support ticket 42',
    }
    const started: ActiveModeRow = {
      ...owner,
      revision: 1,
      revisionNonce: 'a'.repeat(32),
      modeId: event.modeId!,
      lastTransitionId: event.id,
      updatedAt: event.at,
      state: 'active',
      access: 'view',
      targetId: 'initial-target',
      targetIncarnation: 'target-v1',
      actorStampHash: 'a'.repeat(64),
      targetStampHash: 'b'.repeat(64),
      reason: 'Support ticket 42',
      startedAt: event.at,
      expiresAt: '2026-01-01T00:15:00.000Z',
    }
    assert.equal(await store.read(owner), null)
    const competitorId = randomUUID()
    const competitorModeId = randomUUID()
    const competitor = {
      ...started,
      modeId: competitorModeId,
      revisionNonce: 'b'.repeat(32),
      lastTransitionId: competitorId,
    }
    const results = await Promise.all([
      store.compareAndSet({ owner, expected: null, next: started, event }),
      store.compareAndSet({
        owner,
        expected: null,
        next: competitor,
        event: { ...event, id: competitorId, modeId: competitorModeId },
      }),
    ])
    assert.equal(results.filter((result) => result.status === 'applied').length, 1)
    assert.equal(results.filter((result) => result.status === 'conflict').length, 1)
    for (const [index, result] of results.entries())
      if (result.status === 'applied')
        assert.equal(result.transitionId, index === 0 ? event.id : competitorId)
    const winner = (await store.read(owner))!
    const winningIndex = results.findIndex((result) => result.status === 'applied')
    assert.deepEqual(winner, winningIndex === 0 ? started : competitor)
    assert.equal(winner.revision, 1)
    winner.revision = 99
    assert.equal((await store.read(owner))!.revision, 1)
    // The store keeps its own copy of the committed row, not the caller's object.
    const committedNonce = winner.revisionNonce
    started.revisionNonce = 'z'.repeat(32)
    competitor.revisionNonce = 'z'.repeat(32)
    assert.equal((await store.read(owner))!.revisionNonce, committedNonce)
    started.revisionNonce = 'a'.repeat(32)
    competitor.revisionNonce = 'b'.repeat(32)
    for (const other of [
      { ...owner, namespace: 'other' },
      { ...owner, actorId: randomUUID() },
      { ...owner, actorIncarnation: 'replacement' },
    ])
      assert.equal(await store.read(other), null)
    const stale = await store.compareAndSet({
      owner,
      expected: 0,
      next: { ...started, revision: 2 },
      event: { ...event, id: randomUUID(), revision: 2 },
    })
    assert.equal(stale.status, 'conflict')
    const skippedId = randomUUID()
    await assert.rejects(() =>
      store.compareAndSet({
        owner,
        expected: 1,
        next: {
          ...started,
          revision: 3,
          revisionNonce: 'c'.repeat(32),
          lastTransitionId: skippedId,
        },
        event: { ...event, id: skippedId, revision: 3 },
      })
    )
    assert.equal((await store.read(owner))!.revision, 1)
    const transitionId = randomUUID()
    const update: IdleModeRow = {
      ...winner,
      revision: 2,
      revisionNonce: 'c'.repeat(32),
      lastTransitionId: transitionId,
      state: 'idle',
      access: null,
      targetId: null,
      targetIncarnation: null,
      actorStampHash: null,
      targetStampHash: null,
      reason: null,
      startedAt: null,
      expiresAt: null,
    }
    const updated = await store.compareAndSet({
      owner,
      expected: 1,
      next: update,
      event: {
        ...event,
        id: transitionId,
        modeId: winner.modeId,
        kind: 'stopped',
        outcomeCode: 'stopped',
        revision: 2,
        reason: undefined,
      },
    })
    assert.deepEqual(updated, { status: 'applied', transitionId })
    await store.recordControlOutcome({
      ...owner,
      id: randomUUID(),
      modeId: winner.modeId,
      at: event.at,
      kind: 'control_noop',
      outcomeCode: 'idle',
      revision: 2,
    })
    assert.deepEqual(await store.read(owner), update)
    // A control outcome is audit only: it never creates or changes a mode row.
    const absent = { ...owner, actorId: randomUUID() }
    await store.recordControlOutcome({
      ...absent,
      id: randomUUID(),
      at: event.at,
      kind: 'start_denied',
      outcomeCode: 'E_MASQUERADE_NOT_ALLOWED',
      revision: 0,
    })
    assert.equal(await store.read(absent), null)
    await assert.rejects(() =>
      store.recordControlOutcome({
        ...event,
        id: randomUUID(),
        kind: 'started' as never,
        revision: 2,
      })
    )
    assert.equal(await store.pruneEvents({ before: '2027-01-01T00:00:00.000Z', limit: 2 }), 2)
    assert.equal(await store.pruneEvents({ before: '2027-01-01T00:00:00.000Z', limit: 3 }), 2)
    assert.deepEqual(await store.read(owner), update)
    assert.deepEqual(await store.expiredBatch({ now: '2027-01-01T00:00:00.000Z', limit: 2 }), [])
    assert.deepEqual(await store.activeBatch({ limit: 2 }), [])
    // Exercise all owner-key dimensions through writes, not only absent reads.
    const owners = [
      owner,
      { ...owner, namespace: 'other' },
      { ...owner, actorId: randomUUID() },
      { ...owner, actorIncarnation: 'replacement' },
    ]
    const activeRows: (ActiveModeRow & { reason: string })[] = []
    // Insert newest first, so batch order must come from updatedAt, not insertion order.
    for (const [index, activeOwner] of [...owners.entries()].reverse()) {
      const id = randomUUID()
      const at = `2026-01-01T00:00:0${index}.000Z`
      const active = {
        ...started,
        ...activeOwner,
        modeId: randomUUID(),
        revision: index === 0 ? 3 : 1,
        revisionNonce: 'd'.repeat(32),
        lastTransitionId: id,
        updatedAt: at,
        state: 'active' as const,
        access: index % 2 === 0 ? ('view' as const) : ('edit' as const),
        targetId: `target-${index}`,
        targetIncarnation: 'target-v1',
        actorStampHash: 'a'.repeat(64),
        targetStampHash: 'b'.repeat(64),
        reason: 'Support ticket 42',
        startedAt: at,
        expiresAt: index === 3 ? '2026-01-01T00:30:00.000Z' : '2026-01-01T00:15:00.000Z',
      }
      const activeResult = await store.compareAndSet({
        owner: activeOwner,
        expected: index === 0 ? 2 : null,
        next: active,
        event: {
          ...event,
          ...activeOwner,
          id,
          modeId: active.modeId,
          at,
          kind: 'started',
          outcomeCode: 'started',
          revision: active.revision,
          targetId: active.targetId,
          targetIncarnation: active.targetIncarnation,
          access: active.access,
          reason: active.reason,
        },
      })
      assert.deepEqual(activeResult, { status: 'applied', transitionId: id })
      activeRows[index] = active
    }
    for (const active of activeRows) assert.deepEqual(await store.read(active), active)
    const activeRow = activeRows[0]!
    const endingId = randomUUID()
    const ending: IdleModeRow = {
      ...activeRow,
      revision: activeRow.revision + 1,
      revisionNonce: 'f'.repeat(32),
      lastTransitionId: endingId,
      state: 'idle',
      access: null,
      targetId: null,
      targetIncarnation: null,
      actorStampHash: null,
      targetStampHash: null,
      reason: null,
      startedAt: null,
      expiresAt: null,
    }
    const stopped: TransitionEvent = {
      ...owner,
      id: endingId,
      modeId: activeRow.modeId,
      at: activeRow.updatedAt,
      kind: 'stopped',
      outcomeCode: 'stopped',
      revision: ending.revision,
      targetId: activeRow.targetId,
      targetIncarnation: activeRow.targetIncarnation,
      access: activeRow.access,
    }
    // Each rejected write differs from an otherwise valid stop in one field.
    const invalidStops = [
      { next: ending, event: { ...stopped, targetId: 'different-target' } },
      { next: ending, event: { ...stopped, targetIncarnation: 'different-incarnation' } },
      {
        next: ending,
        event: {
          ...stopped,
          access: activeRow.access === 'view' ? ('edit' as const) : ('view' as const),
        },
      },
      { next: { ...ending, lastTransitionId: randomUUID() }, event: stopped },
      { next: ending, event: { ...stopped, actorId: randomUUID() } },
      { next: ending, event: { ...stopped, namespace: 'different-namespace' } },
      { next: ending, event: { ...stopped, actorIncarnation: 'different-incarnation' } },
      { next: ending, event: { ...stopped, revision: ending.revision + 1 } },
      { next: ending, event: { ...stopped, modeId: randomUUID() } },
    ]
    for (const invalid of invalidStops) {
      await assert.rejects(() =>
        store.compareAndSet({
          owner: activeRow,
          expected: activeRow.revision,
          next: invalid.next,
          event: invalid.event,
        })
      )
      assert.deepEqual(await store.read(activeRow), activeRow)
    }
    assert.deepEqual(await store.expiredBatch({ now: '2026-01-01T00:14:59.999Z', limit: 2 }), [])
    const expired = await store.expiredBatch({ now: '2026-01-01T00:15:00.000Z', limit: 2 })
    assert.deepEqual(expired, activeRows.slice(0, 2))
    expired[0].revision = 999
    assert.deepEqual(
      await store.expiredBatch({ now: '2026-01-01T00:15:00.000Z', limit: 10 }),
      activeRows.slice(0, 3)
    )
    assert.deepEqual(
      await store.expiredBatch({ now: '2026-01-01T00:30:00.000Z', limit: 10 }),
      activeRows
    )
    // Active rows regardless of expiry, oldest update first, as independent snapshots.
    const activeSnapshots = await store.activeBatch({ limit: 2 })
    assert.deepEqual(activeSnapshots, activeRows.slice(0, 2))
    activeSnapshots[0].revision = 999
    assert.deepEqual(await store.activeBatch({ limit: 10 }), activeRows)
    assert.equal(await store.pruneEvents({ before: '2026-01-01T00:00:00.000Z', limit: 10 }), 0)
    assert.equal(await store.pruneEvents({ before: '2026-01-01T00:00:02.000Z', limit: 1 }), 1)
    assert.equal(await store.pruneEvents({ before: '2026-01-01T00:00:02.000Z', limit: 10 }), 1)
    assert.equal(await store.pruneEvents({ before: '2027-01-01T00:00:00.000Z', limit: 10 }), 2)
    for (const active of activeRows) assert.deepEqual(await store.read(active), active)
    // An optional reason permissions stores an active row without a reason and omits it from the event.
    const unreasonedOwner = { ...owner, actorId: randomUUID() }
    const unreasonedId = randomUUID()
    const unreasoned = {
      ...activeRows[1]!,
      ...unreasonedOwner,
      modeId: randomUUID(),
      lastTransitionId: unreasonedId,
      reason: null,
    }
    const unreasonedResult = await store.compareAndSet({
      owner: unreasonedOwner,
      expected: null,
      next: unreasoned,
      event: {
        ...event,
        ...unreasonedOwner,
        id: unreasonedId,
        modeId: unreasoned.modeId,
        at: unreasoned.updatedAt,
        kind: 'started',
        outcomeCode: 'started',
        revision: unreasoned.revision,
        targetId: unreasoned.targetId,
        targetIncarnation: unreasoned.targetIncarnation,
        access: unreasoned.access,
        reason: undefined,
      },
    })
    assert.deepEqual(unreasonedResult, { status: 'applied', transitionId: unreasonedId })
    assert.deepEqual(await store.read(unreasonedOwner), unreasoned)
  }
}

/**
 * Run against a fresh, isolated store. SQL connection/race and rollback tests supplement this contract.
 *
 * @example
 * ```ts
 * import {
 *   controlStoreConformance,
 *   MemoryControlStore,
 * } from '@kevinjohn/adonisjs-masquerade/testing'
 * import { test } from '@japa/runner'
 *
 * test('isolated support store contract', async () => {
 *   await controlStoreConformance.assert(async () => new MemoryControlStore())
 * })
 * ```
 */
export const controlStoreConformance = new ControlStoreConformance()
