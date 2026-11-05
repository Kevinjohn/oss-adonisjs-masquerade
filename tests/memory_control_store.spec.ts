import { test } from '@japa/runner'
import { assertControlStoreConformance, MemoryControlStore } from '../testing/main.js'
import type { TransitionEvent } from '../src/types.js'
import { fixture } from './helpers/core.js'

test('memory store satisfies exported isolated ControlStore conformance', async () => {
  await assertControlStoreConformance(async () => new MemoryControlStore())
})

test('memory CAS clones inputs/outputs, commits one event and preserves row on event serialization failure', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  await f.start(service)
  const row = (await f.store.read(f.owner))!
  const event = f.store.events[0] as TransitionEvent
  const next = { ...row, revision: 2 }
  await assert.rejects(() =>
    f.store.compareAndSet({
      owner: f.owner,
      expected: 1,
      next,
      event: { ...event, revision: 2, invalid: () => {} } as never,
    })
  )
  assert.deepEqual(await f.store.read(f.owner), row)
  assert.lengthOf(f.store.events, 1)
  row.revision = 20
  event.revision = 20
  assert.equal((await f.store.read(f.owner))!.revision, 1)
  assert.equal(f.store.events[0].revision, 1)
})

test('memory CAS rejects transition identity and projection mismatches without mutation', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  await f.start(service)
  const row = (await f.store.read(f.owner))!
  const event = f.store.events[0] as TransitionEvent
  const attempts = [
    {
      owner: f.owner,
      next: { ...row, actorId: 'other', revision: 2 },
      event: { ...event, revision: 2 },
    },
    {
      owner: f.owner,
      next: { ...row, revision: 2, lastTransitionId: '00000000-0000-4000-8000-000000000001' },
      event: { ...event, revision: 2 },
    },
    {
      owner: f.owner,
      next: { ...row, revision: 2 },
      event: { ...event, revision: 2, id: '00000000-0000-4000-8000-000000000002' },
    },
    {
      owner: f.owner,
      next: { ...row, revision: 2, modeId: '00000000-0000-4000-8000-000000000003' },
      event: { ...event, revision: 2 },
    },
    {
      owner: f.owner,
      next: { ...row, revision: 2 },
      event: { ...event, revision: 2, targetId: 'different' },
    },
  ]
  for (const attempt of attempts) {
    await assert.rejects(
      () =>
        f.store.compareAndSet({
          owner: attempt.owner,
          expected: 1,
          next: attempt.next,
          event: attempt.event,
        }),
      'Masquerade is unavailable'
    )
    assert.deepEqual(await f.store.read(f.owner), row)
    assert.lengthOf(f.store.events, 1)
  }
})

test('expiry batches are bounded snapshots and event pruning never deletes mode rows', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  if (!active.isMasquerading) throw new Error('Expected active')
  assert.deepEqual(await f.store.expiredBatch({ now: active.startedAt, limit: 10 }), [])
  const batch = await f.store.expiredBatch({ now: active.expiresAt, limit: 1 })
  assert.lengthOf(batch, 1)
  batch[0].revision = 42
  assert.equal((await f.store.read(f.owner))!.revision, 1)
  assert.equal(await f.store.pruneEvents({ before: '2027-01-01T00:00:00.000Z', limit: 1 }), 1)
  assert.equal((await f.store.read(f.owner))!.revision, 1)
})

test('memory CAS rejects a malformed row as the Lucid store does', async ({ assert }) => {
  const f = fixture()
  await f.start(await f.create())
  const row = (await f.store.read(f.owner))!
  const event = f.store.events[0] as TransitionEvent
  for (const change of [{ state: 'bogus' }, { revisionNonce: 'x' }])
    await assert.rejects(() =>
      f.store.compareAndSet({
        owner: f.owner,
        expected: 1,
        next: { ...row, revision: 2, ...change } as never,
        event: { ...event, id: row.lastTransitionId, revision: 2 },
      })
    )
  assert.deepEqual(await f.store.read(f.owner), row)
})
