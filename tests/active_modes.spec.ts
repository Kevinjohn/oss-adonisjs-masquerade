import { test } from '@japa/runner'
import { listActiveModes, MAX_ACTIVE_MODE_LIMIT } from '../src/active_modes.js'
import { errorCode, fixture } from './helpers/core.js'

test.group('active mode listing', () => {
  test('lists active modes without their reason', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    assert.deepEqual(await listActiveModes(f.config, f.dependencies), [])
    await f.start(service)
    const modes = await listActiveModes(f.config, f.dependencies)
    const row = await f.store.read(f.owner)
    assert.deepEqual(modes, [
      {
        namespace: 'test',
        actorId: 'a',
        actorIncarnation: 'a',
        targetId: 'b',
        access: 'view',
        startedAt: row!.state === 'active' ? row!.startedAt : '',
        expiresAt: row!.state === 'active' ? row!.expiresAt : '',
        revision: row!.revision,
      },
    ])
    assert.notProperty(modes[0], 'reason')
  })

  test('bounds the listing and passes the limit to the store', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    await f.start(service, { actorId: 'c' })
    const limits: number[] = []
    const activeBatch = f.store.activeBatch.bind(f.store)
    f.store.activeBatch = async (input) => {
      limits.push(input.limit)
      return activeBatch(input)
    }
    assert.lengthOf(await listActiveModes(f.config, f.dependencies, { limit: 1 }), 1)
    assert.lengthOf(await listActiveModes(f.config, f.dependencies), 2)
    assert.deepEqual(limits, [1, 50])
    for (const limit of [0, MAX_ACTIVE_MODE_LIMIT + 1, 1.5])
      assert.equal(
        await errorCode(() => listActiveModes(f.config, f.dependencies, { limit })),
        'E_MASQUERADE_UNAVAILABLE'
      )
  })

  test('fails closed on a store without activeBatch or with an oversized batch', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const activeBatch = f.store.activeBatch.bind(f.store)
    f.store.activeBatch = async () => [
      ...(await activeBatch({ limit: 10 })),
      ...(await activeBatch({ limit: 10 })),
    ]
    assert.equal(
      await errorCode(() => listActiveModes(f.config, f.dependencies, { limit: 1 })),
      'E_MASQUERADE_UNAVAILABLE'
    )
    Object.defineProperty(f.store, 'activeBatch', { value: undefined })
    assert.equal(
      await errorCode(() => listActiveModes(f.config, f.dependencies)),
      'E_MASQUERADE_UNAVAILABLE'
    )
  })
})

test('a batch row with an unsafe namespace fails closed in listing and prune', async ({
  assert,
}) => {
  const { pruneMasquerade } = await import('../src/prune.js')
  const f = fixture()
  await f.start(await f.create())
  const row = (await f.store.read(f.owner))!
  const unsafe = { ...row, namespace: '../other' }
  f.store.activeBatch = async () => [unsafe]
  f.store.expiredBatch = async () => [unsafe]
  f.store.read = async () => unsafe
  assert.equal(
    await errorCode(() => listActiveModes(f.config, f.dependencies)),
    'E_MASQUERADE_UNAVAILABLE'
  )
  assert.equal(
    await errorCode(() => pruneMasquerade(f.config, f.dependencies)),
    'E_MASQUERADE_UNAVAILABLE'
  )
})
