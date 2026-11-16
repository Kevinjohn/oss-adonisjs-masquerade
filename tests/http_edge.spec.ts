import { test } from '@japa/runner'
import { fixture } from './helpers/core.js'
import { requestContext } from './helpers/http_context.js'
import { contextField, shareMasquerade } from '../http/edge.js'

test.group('masquerade HTTP boundary', () => {
  test('renders an escaped hidden context field from a safe view', ({ assert }) => {
    assert.equal(
      contextField({ isMasquerading: false, contextToken: '0.' + 'a'.repeat(64) }),
      `<input type="hidden" name="_masqueradeContext" value="0.${'a'.repeat(64)}">`
    )
  })

  test('escapes every attribute metacharacter in the hidden context field', ({ assert }) => {
    assert.equal(
      contextField({ isMasquerading: false, contextToken: `"'<&>` }),
      '<input type="hidden" name="_masqueradeContext" value="&quot;&#39;&lt;&amp;&gt;">'
    )
  })

  test('shares Edge state from the memoized admission snapshot without rereading storage', async ({
    assert,
  }) => {
    const f = fixture()
    let reads = 0
    const read = f.store.read.bind(f.store)
    f.store.read = async (owner) => {
      reads++
      return read(owner)
    }
    const { ctx, responseState } = requestContext(f, { method: 'GET' })
    let shared: Record<string, unknown> | undefined
    ;(ctx as { view: { share(value: Record<string, unknown>): void } }).view = {
      share: (value) => {
        shared = value
      },
    }
    const mode = await shareMasquerade(ctx)
    assert.equal(reads, 1)
    assert.deepEqual(shared?.masquerade, mode)
    assert.equal(responseState.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(await shareMasquerade(ctx), mode)
    assert.equal(reads, 1)
  })

  test('shares read-only status on a raw route without admitting or invalidating the mode', async ({
    assert,
  }) => {
    const f = fixture()
    const { ctx, responseState } = requestContext(f, {
      method: 'GET',
      routeMiddleware: [{ name: 'auth', args: [{ guards: ['web'] }] }],
    })
    await f.start(await f.create(), ctx)
    const before = await f.store.read(f.owner)
    f.users.get('b')!.stamp = 'changed'
    const mode = await shareMasquerade(ctx)
    assert.isTrue(mode.isMasquerading)
    assert.deepEqual(await f.store.read(f.owner), before)
    assert.equal(responseState.headers.get('cache-control'), 'private, no-store')
  })

  test('shares owner status on an unclassified page with private headers and no admission', async ({
    assert,
  }) => {
    const f = fixture()
    const { ctx, responseState } = requestContext(f, { method: 'GET', routeMiddleware: [] })
    await f.start(await f.create(), ctx)
    const before = await f.store.read(f.owner)
    const policyCalls = f.state.policyCount

    const mode = await shareMasquerade(ctx)

    assert.isTrue(mode.isMasquerading)
    if (mode.isMasquerading) assert.equal(mode.targetId, 'b')
    assert.deepEqual(await f.store.read(f.owner), before)
    assert.equal(f.state.policyCount, policyCalls)
    assert.equal(responseState.headers.get('cache-control'), 'private, no-store')
  })

  test('does not set cache headers when reading status fails', async ({ assert }) => {
    const f = fixture()
    const { ctx, responseState } = requestContext(f, { method: 'GET', routeMiddleware: [] })
    f.store.read = async () => {
      throw new Error('store unavailable')
    }

    await assert.rejects(() => shareMasquerade(ctx))
    assert.isEmpty(responseState.headers)
  })
})
