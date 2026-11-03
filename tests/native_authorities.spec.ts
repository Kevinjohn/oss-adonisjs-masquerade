import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import type { NativeRuntimeAdapter } from '../src/integration/native_binding.js'
import { nativeAuthorities } from '../native/main.js'
import type { NativeAuthority, Subject } from '../src/types.js'

function adapter(authority: NativeAuthority<{ id: string }>, guard?: string): NativeRuntimeAdapter {
  return {
    authority,
    ...(guard === undefined ? {} : { guard }),
    async authenticateActor() {
      return { id: 'actor', incarnation: 'v1', user: { id: 'actor' } } as Subject<unknown>
    },
  }
}

function makeAuthority(guard: string): NativeAuthority<{ id: string }> {
  return {
    namespace: 'users',
    guard,
    incarnation: 'id',
    securityStamp: () => 'stamp',
    inspectAccount: async () => null,
  }
}

test('native authorities retain the primary authority and freeze adapters by effective raw guard', async ({
  assert,
}) => {
  const primaryAuthority = makeAuthority('web')
  const tokenAuthority = primaryAuthority
  const primary = adapter(primaryAuthority)
  const tokens = adapter(tokenAuthority, 'api')
  const composed = nativeAuthorities(primary, [tokens])

  assert.strictEqual(composed.authority, primaryAuthority)
  assert.strictEqual(composed.adapters!.web, primary)
  assert.strictEqual(composed.adapters!.api, tokens)
  assert.isTrue(Object.isFrozen(composed.adapters))
  assert.isFalse(Reflect.set(composed.adapters!, 'api', primary))
  const ctx = {} as never
  assert.deepEqual(await composed.authenticateActor(ctx), {
    id: 'actor',
    incarnation: 'v1',
    user: { id: 'actor' },
  })
})

test('native authorities reject a different authority object, even with matching fields', async ({
  assert,
}) => {
  const primary = adapter(makeAuthority('web'))
  const unrelated = adapter(makeAuthority('web'), 'api')
  assert.throws(
    () => nativeAuthorities(primary, [unrelated]),
    'Additional native adapters must share the primary authority'
  )
})

test('native authorities reject duplicate and malformed effective guards', async ({ assert }) => {
  const shared = makeAuthority('web')
  assert.throws(
    () => nativeAuthorities(adapter(shared), [adapter(shared, 'web')]),
    'Native adapters must use unique guards'
  )
  assert.throws(
    () => nativeAuthorities(adapter(makeAuthority('')), []),
    'Invalid native adapter guard'
  )
  assert.throws(
    () => nativeAuthorities(adapter(shared), [adapter(shared, '\u0000')]),
    'Invalid native adapter guard'
  )
  assert.throws(
    () => nativeAuthorities(adapter(shared), [null] as never),
    'Invalid native adapter guard'
  )
  assert.throws(
    () => nativeAuthorities(adapter(shared), null as never),
    'Invalid native adapter guard'
  )
})

test('native authorities preserve method receivers and reject nested compositions', async ({
  assert,
}) => {
  const shared = makeAuthority('web')
  const primary = new (class {
    authority = shared
    authenticateActor() {
      return Promise.resolve({ id: this.authority.guard, incarnation: 'v1', user: { id: 'actor' } })
    }
  })() as NativeRuntimeAdapter
  const composed = nativeAuthorities(primary)
  const actor = await composed.authenticateActor({} as HttpContext)
  assert.equal(actor.id, 'web')
  assert.throws(
    () => nativeAuthorities(composed, [adapter(shared, 'api')]),
    'Native adapter compositions cannot be nested'
  )
})

test('native authorities preserve the primary authority and actor user types', ({ assert }) => {
  type User = { id: string; tenant: string }
  const userAuthority: NativeAuthority<User> = {
    namespace: 'users',
    guard: 'web',
    incarnation: (user) => user.tenant,
    securityStamp: (user) => user.tenant,
    inspectAccount: async () => null,
  }
  const primary = {
    authority: userAuthority,
    async authenticateActor(_ctx: HttpContext): Promise<Subject<User>> {
      return { id: 'actor', incarnation: 'tenant-a', user: { id: 'actor', tenant: 'tenant-a' } }
    },
  }
  const composed = nativeAuthorities(primary)
  function acceptsTypedComposition(value: typeof composed): void {
    const authority: NativeAuthority<User> = value.authority
    const authenticateActor: (ctx: HttpContext) => Promise<Subject<User>> = value.authenticateActor
    assert.strictEqual(authority, userAuthority)
    assert.isFunction(authenticateActor)
  }
  acceptsTypedComposition(composed)
})
