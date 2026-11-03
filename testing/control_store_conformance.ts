import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { ControlStore, IdleModeRow, OwnerKey, TransitionEvent } from '../src/types.js'

/** Run against a fresh, isolated store. SQL connection/race and rollback tests supplement this contract. */
export async function assertControlStoreConformance(
  createStore: () => Promise<ControlStore>
): Promise<void> {
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
    kind: 'stopped',
    outcomeCode: 'stopped',
    revision: 1,
  }
  const row: IdleModeRow = {
    ...owner,
    revision: 1,
    revisionNonce: 'a'.repeat(32),
    modeId: event.modeId!,
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
  }
  assert.equal(await store.read(owner), null)
  const competitorId = randomUUID()
  const commands = await Promise.all([
    store.compareAndSet({ owner, expected: null, next: row, event }),
    store.compareAndSet({
      owner,
      expected: null,
      next: { ...row, revisionNonce: 'b'.repeat(32), lastTransitionId: competitorId },
      event: { ...event, id: competitorId },
    }),
  ])
  assert.equal(commands.filter((result) => result.status === 'applied').length, 1)
  assert.equal(commands.filter((result) => result.status === 'conflict').length, 1)
  const winner = (await store.read(owner))!
  assert.equal(winner.revision, 1)
  winner.revision = 99
  assert.equal((await store.read(owner))!.revision, 1)
  for (const other of [
    { ...owner, namespace: 'other' },
    { ...owner, actorId: randomUUID() },
    { ...owner, actorIncarnation: 'replacement' },
  ])
    assert.equal(await store.read(other), null)
  const stale = await store.compareAndSet({
    owner,
    expected: 0,
    next: { ...row, revision: 2 },
    event: { ...event, id: randomUUID(), revision: 2 },
  })
  assert.equal(stale.status, 'conflict')
  const transitionId = randomUUID()
  const update = {
    ...row,
    revision: 2,
    revisionNonce: 'c'.repeat(32),
    lastTransitionId: transitionId,
  }
  const updated = await store.compareAndSet({
    owner,
    expected: 1,
    next: update,
    event: { ...event, id: transitionId, revision: 2 },
  })
  assert.equal(updated.status, 'applied')
  await store.recordControlOutcome({
    ...event,
    id: randomUUID(),
    kind: 'control_noop',
    revision: 2,
  })
  assert.deepEqual(await store.read(owner), update)
  assert.equal(await store.pruneEvents({ before: '2027-01-01T00:00:00.000Z', limit: 2 }), 2)
  assert.equal(await store.pruneEvents({ before: '2027-01-01T00:00:00.000Z', limit: 2 }), 1)
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
  const activeRows = []
  for (const [index, activeOwner] of owners.entries()) {
    const id = randomUUID()
    const at = `2026-01-01T00:00:0${index}.000Z`
    const active = {
      ...row,
      ...activeOwner,
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
    assert.equal(activeResult.status, 'applied')
    activeRows.push(active)
  }
  for (const active of activeRows) assert.deepEqual(await store.read(active), active)
  const activeRow = activeRows[0]!
  const invalidId = randomUUID()
  const invalidNext = {
    ...activeRow,
    revision: activeRow.revision + 1,
    revisionNonce: 'e'.repeat(32),
    lastTransitionId: invalidId,
  }
  await assert.rejects(() =>
    store.compareAndSet({
      owner: activeRow,
      expected: activeRow.revision,
      next: invalidNext,
      event: {
        ...event,
        ...activeRow,
        id: invalidId,
        at: activeRow.updatedAt,
        kind: 'started',
        outcomeCode: 'started',
        revision: invalidNext.revision,
        targetId: 'different-target',
        targetIncarnation: activeRow.targetIncarnation,
      },
    })
  )
  assert.deepEqual(await store.read(activeRow), activeRow)
  await assert.rejects(() =>
    store.compareAndSet({
      owner: activeRow,
      expected: activeRow.revision,
      next: invalidNext,
      event: {
        ...event,
        ...activeRow,
        id: invalidId,
        at: activeRow.updatedAt,
        kind: 'started',
        outcomeCode: 'started',
        revision: invalidNext.revision,
        targetId: activeRow.targetId,
        targetIncarnation: activeRow.targetIncarnation,
        access: activeRow.access === 'view' ? 'edit' : 'view',
      },
    })
  )
  assert.deepEqual(await store.read(activeRow), activeRow)
  await assert.rejects(() =>
    store.compareAndSet({
      owner: activeRow,
      expected: activeRow.revision,
      next: { ...invalidNext, lastTransitionId: randomUUID() },
      event: {
        ...event,
        ...activeRow,
        id: invalidId,
        at: activeRow.updatedAt,
        kind: 'started',
        outcomeCode: 'started',
        revision: invalidNext.revision,
        targetId: activeRow.targetId,
        targetIncarnation: activeRow.targetIncarnation,
      },
    })
  )
  assert.deepEqual(await store.read(activeRow), activeRow)
  const mismatchedOwner = randomUUID()
  await assert.rejects(() =>
    store.compareAndSet({
      owner: activeRow,
      expected: activeRow.revision,
      next: invalidNext,
      event: {
        ...event,
        ...activeRow,
        actorId: mismatchedOwner,
        id: invalidId,
        at: activeRow.updatedAt,
        kind: 'started',
        outcomeCode: 'started',
        revision: invalidNext.revision,
        targetId: activeRow.targetId,
        targetIncarnation: activeRow.targetIncarnation,
      },
    })
  )
  assert.deepEqual(await store.read(activeRow), activeRow)
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
  await assert.rejects(() =>
    store.compareAndSet({
      owner: activeRow,
      expected: activeRow.revision,
      next: ending,
      event: {
        ...event,
        ...activeRow,
        id: endingId,
        at: activeRow.updatedAt,
        kind: 'stopped',
        outcomeCode: 'stopped',
        revision: ending.revision,
        targetId: 'different-target',
      },
    })
  )
  assert.deepEqual(await store.read(activeRow), activeRow)
  for (const mismatch of [
    { namespace: 'different-namespace' },
    { actorIncarnation: 'different-incarnation' },
    { revision: invalidNext.revision + 1 },
    { modeId: randomUUID() },
  ]) {
    await assert.rejects(() =>
      store.compareAndSet({
        owner: activeRow,
        expected: activeRow.revision,
        next: invalidNext,
        event: {
          ...event,
          ...activeRow,
          id: invalidId,
          at: activeRow.updatedAt,
          kind: 'started',
          outcomeCode: 'started',
          revision: invalidNext.revision,
          targetId: activeRow.targetId,
          targetIncarnation: activeRow.targetIncarnation,
          ...mismatch,
        },
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
  // An optional reason policy stores an active row without a reason and omits it from the event.
  const unreasonedOwner = { ...owner, actorId: randomUUID() }
  const unreasonedId = randomUUID()
  const unreasoned = {
    ...activeRows[1]!,
    ...unreasonedOwner,
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
      at: unreasoned.updatedAt,
      kind: 'started',
      outcomeCode: 'started',
      revision: unreasoned.revision,
      targetId: unreasoned.targetId,
      targetIncarnation: unreasoned.targetIncarnation,
      access: unreasoned.access,
    },
  })
  assert.equal(unreasonedResult.status, 'applied')
  assert.deepEqual(await store.read(unreasonedOwner), unreasoned)
}
