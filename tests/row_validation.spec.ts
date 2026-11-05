import { test } from '@japa/runner'
import { fixture, errorCode } from './helpers/core.js'
import { validateRow } from '../src/row_validation.js'

test('access fails closed', async ({ assert }) => {
  const f = fixture()
  const service = await f.create()
  const active = await f.start(service)
  const row = (await f.store.read(f.owner))!
  for (const access of [undefined, null, 'unknown'])
    assert.throws(
      () => validateRow({ ...row, access } as never, f.owner),
      'Masquerade is unavailable'
    )
  await service.stop({}, { expectedContext: active.contextToken })
  const idle = (await f.store.read(f.owner))!
  assert.throws(
    () => validateRow({ ...idle, access: 'view' } as never, f.owner),
    'Masquerade is unavailable'
  )
})

test('malformed store rows fail closed across status, controls and admission', async ({
  assert,
}) => {
  const f = fixture()
  const service = await f.create()
  await f.start(service)
  const original = f.store.read.bind(f.store)
  const row = (await original(f.owner))!
  for (const patch of [
    { revision: '1' },
    { revision: 0 },
    { revision: 1.5 },
    { revision: Infinity },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { state: 'unknown' },
    { revisionNonce: [row.revisionNonce] },
    { modeId: [row.modeId] },
    { lastTransitionId: [row.lastTransitionId] },
    { actorStampHash: [row.actorStampHash] },
    { targetStampHash: [row.targetStampHash] },
    { actorStampHash: 'secret' },
    { namespace: 'other' },
    { actorId: 'other' },
    { actorIncarnation: 'other' },
    { targetId: 'x'.repeat(256) },
    { targetIncarnation: 'x'.repeat(129) },
    { reason: 'x'.repeat(501) },
    { reason: ' untrimmed ' },
    { reason: '' },
    { startedAt: 'yesterday' },
    { expiresAt: row.startedAt },
    { updatedAt: '2026-02-30T00:00:00.000Z' },
  ]) {
    f.store.read = async () => ({ ...row, ...patch }) as never
    for (const operation of [
      () => service.status({}),
      () => service.resolve({}),
      () =>
        service.start(
          {},
          { targetId: 'c', reason: 'case', expectedContext: `${row.revision}.${row.revisionNonce}` }
        ),
      () => service.stop({}, { expectedContext: `${row.revision}.${row.revisionNonce}` }),
    ])
      assert.equal(await errorCode(operation), 'E_MASQUERADE_UNAVAILABLE')
    assert.deepEqual(await original(f.owner), row)
  }
  f.store.read = original
  const idle = await service.stop({}, { expectedContext: `${row.revision}.${row.revisionNonce}` })
  const idleRow = (await original(f.owner))!
  assert.throws(
    () => validateRow({ ...idleRow, reason: 'retained' } as never, f.owner),
    'Masquerade is unavailable'
  )
  assert.isFalse(idle.isMasquerading)
})

test('an active row longer than the one-hour maximum fails closed', async ({ assert }) => {
  const f = fixture()
  await f.start(await f.create())
  const row = (await f.store.read(f.owner))!
  if (row.state !== 'active') throw new Error('Expected active')
  const startedAt = Date.parse(row.startedAt)
  const at = (offset: number) => new Date(startedAt + offset).toISOString()
  assert.deepEqual(validateRow({ ...row, expiresAt: at(3_600_000) }, f.owner), {
    ...row,
    expiresAt: at(3_600_000),
  })
  assert.throws(
    () => validateRow({ ...row, expiresAt: at(3_600_001) }, f.owner),
    'Masquerade is unavailable'
  )
})
