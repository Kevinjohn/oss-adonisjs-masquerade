import { test } from '@japa/runner'
import { fixture } from './helpers/core.js'
import { requestContext } from './helpers/http_context.js'
import { masqueradeAuditFields } from '../http/audit_fields.js'

test.group('masquerade audit fields', () => {
  test('returns the actor as both identities while idle', async ({ assert }) => {
    const f = fixture()
    const { ctx } = requestContext(f, { method: 'GET' })
    const fields = await masqueradeAuditFields(ctx)
    assert.deepEqual(fields, {
      actorId: 'a',
      actorIncarnation: 'a',
      effectiveId: 'a',
      effectiveIncarnation: 'a',
      isMasquerading: false,
      modeId: null,
      access: null,
    })
    assert.isTrue(Object.isFrozen(fields))
  })

  for (const access of ['view', 'edit'] as const)
    test(`returns the actor, target, mode and ${access} access while masquerading`, async ({
      assert,
    }) => {
      const f = fixture()
      const { ctx } = requestContext(f, { method: 'GET' })
      await f.start(await f.create(), ctx, access)
      const row = await f.store.read(f.owner)
      const fields = await masqueradeAuditFields(ctx)
      assert.deepEqual(fields, {
        actorId: 'a',
        actorIncarnation: 'a',
        effectiveId: 'b',
        effectiveIncarnation: 'b',
        isMasquerading: true,
        modeId: row!.modeId,
        access,
      })
      for (const secret of ['secret-', 'private-model', 'support', 'contextToken'])
        assert.notInclude(JSON.stringify(fields), secret)
    })

  test('reports the actor alone on a raw route, without admitting or invalidating the mode', async ({
    assert,
  }) => {
    const f = fixture()
    const { ctx } = requestContext(f, {
      method: 'GET',
      routeMiddleware: [{ name: 'auth', args: [{ guards: ['web'] }] }],
    })
    await f.start(await f.create(), ctx)
    const before = await f.store.read(f.owner)
    // A target change would invalidate the mode if this raw request were admitted.
    f.users.get('b')!.stamp = 'changed'
    const fields = await masqueradeAuditFields(ctx)
    assert.deepEqual(fields, {
      actorId: 'a',
      actorIncarnation: 'a',
      effectiveId: 'a',
      effectiveIncarnation: 'a',
      isMasquerading: false,
      modeId: null,
      access: null,
    })
    assert.deepEqual(await f.store.read(f.owner), before)
  })
})
