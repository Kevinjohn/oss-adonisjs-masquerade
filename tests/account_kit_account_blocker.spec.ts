import { NativeAdapter } from '../src/integration/native_adapter.ts'
import { rejects } from 'node:assert/strict'
import type { HttpContext } from '@adonisjs/core/http'
import { test } from '@japa/runner'
import AccountKitBlocker, { AccountKitAccountBlocker } from '../src/account_kit/middleware.ts'
import { errors } from '../index.ts'
import { checkActiveMode } from '../src/active_mode.ts'
import { fixture } from './helpers/core.ts'

async function host() {
  const f = fixture()
  const service = await f.create()
  const calls = { reads: 0, next: 0, authenticated: true, guardFailure: false }
  const ctx = {
    route: { name: 'host.account.password' },
    auth: {
      use(name: string) {
        if (name !== 'raw' || calls.guardFailure) throw new Error('raw guard unavailable')
        return {
          user: f.users.get('a'),
          check: async () => calls.authenticated,
          authenticate: async () => {
            throw new Error('must not require the Masquerade ability or Account Kit current')
          },
        }
      },
    },
    containerResolver: {
      async make(key: unknown) {
        if (key === NativeAdapter)
          return {
            authority: {
              namespace: f.owner.namespace,
              incarnation: (user: { incarnation: string }) => user.incarnation,
            },
            managedGuard: { name: 'raw' },
            provider: {
              createUserForGuard: async (user: { id: string }) => ({ getId: () => user.id }),
            },
          }
        if (key === 'masquerade.runtime')
          return {
            activeMode: async (owner: typeof f.owner) => {
              calls.reads++
              return (
                service as typeof service & {
                  [checkActiveMode](key: typeof f.owner): Promise<boolean>
                }
              )[checkActiveMode](owner)
            },
          }
        throw new Error(`unexpected binding: ${key}`)
      },
    },
  } as unknown as HttpContext
  const next = async () => {
    calls.next++
    return 'handled'
  }
  const request = () => new AccountKitAccountBlocker().handle(ctx, next)
  return { ...f, service, calls, ctx, next, request }
}

test.group('Account Kit host account blocker', () => {
  for (const access of ['view', 'edit'] as const)
    test(`blocks an active ${access} mode by the raw actor without admission or context`, async ({
      assert,
    }) => {
      const h = await host()
      await h.start(h.service, {}, access)
      const before = await h.store.read(h.owner)
      const events = [...h.store.events]
      // A failing permissions or account inspection must not let the actor change their account.
      h.state.permissionsThrows = true
      h.state.inspectThrows = true
      // Host routes need neither a name nor an effective guard to opt in.
      h.ctx.route = undefined
      await rejects(h.request, (error: unknown) => {
        assert.instanceOf(error, errors.E_MASQUERADE_ACTION_BLOCKED)
        const blocked = error as InstanceType<typeof errors.E_MASQUERADE_ACTION_BLOCKED>
        assert.equal(blocked.code, 'E_MASQUERADE_ACTION_BLOCKED')
        assert.equal(blocked.status, 403)
        assert.equal(blocked.blockedBy, 'sensitive')
        return true
      })
      assert.equal(h.calls.next, 0)
      assert.deepEqual(await h.store.read(h.owner), before)
      assert.deepEqual(h.store.events, events)
    })

  test('allows absent, idle and expired modes without changing the row', async ({ assert }) => {
    const h = await host()
    assert.equal(await h.request(), 'handled')
    const started = await h.start(h.service)
    await h.service.stop({}, { expectedContext: started.contextToken })
    assert.equal(await h.request(), 'handled')
    await h.start(h.service)
    const before = await h.store.read(h.owner)
    h.state.now = Date.parse(before!.expiresAt!)
    assert.equal(await h.request(), 'handled')
    assert.deepEqual(await h.store.read(h.owner), before)
    assert.equal(h.calls.reads, 3)
    assert.equal(h.calls.next, 3)
  })

  test('preserves unauthenticated proof flows without a mode read', async ({ assert }) => {
    const h = await host()
    await h.start(h.service)
    h.calls.authenticated = false
    assert.equal(await h.request(), 'handled')
    assert.equal(h.calls.reads, 0)
    assert.equal(h.calls.next, 1)
  })

  test('leaves unselected host routes, stop, logout and CSRF exempt from the global blocker', async ({
    assert,
  }) => {
    const h = await host()
    await h.start(h.service)
    h.calls.guardFailure = true
    for (const name of [
      'host.account.password',
      'masquerade.stop',
      'host.logout',
      'host.csrf',
      'accountKit.account.logout',
      'accountKit.auth.csrf',
    ]) {
      h.ctx.route = { name } as HttpContext['route']
      assert.equal(await new AccountKitBlocker().handle(h.ctx, h.next), 'handled')
    }
    assert.equal(h.calls.reads, 0)
    assert.equal(h.calls.next, 6)
  })

  test('fails closed on raw guard and store failures', async ({ assert }) => {
    const h = await host()
    for (const failure of ['guard', 'store'] as const) {
      h.calls.guardFailure = failure === 'guard'
      if (failure === 'store')
        h.store.read = async () => {
          throw new Error('store down')
        }
      await rejects(h.request, (error: unknown) => {
        assert.instanceOf(error, errors.E_MASQUERADE_UNAVAILABLE)
        const unavailable = error as InstanceType<typeof errors.E_MASQUERADE_UNAVAILABLE>
        assert.equal(unavailable.code, 'E_MASQUERADE_UNAVAILABLE')
        assert.equal(unavailable.status, 503)
        return true
      })
    }
    assert.equal(h.calls.next, 0)
  })
})
