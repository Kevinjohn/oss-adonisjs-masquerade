// masqueradeContext at the HTTP boundary: guard checks, context tokens and the view/edit rule.
// Admission values go to request_admission.spec.ts, route markers to route_metadata.spec.ts.
// Fixtures: fixture() in tests/helpers/core.ts, requestContext() in tests/helpers/http_context.ts.
import { test } from '@japa/runner'
import { fixture } from './helpers/core.js'
import { requestContext } from './helpers/http_context.js'
import { errors } from '@adonisjs/auth'
import { masqueradeContext } from '../http/context_middleware.js'
import { allowMutation, sensitive } from '../integration/route_metadata.js'
import { MasqueradeError } from '../src/errors.js'
import type { RequestAdmission } from '../src/request_admission.js'
import type { MasqueradeBlockedBy } from '../index.js'

test.group('masquerade HTTP boundary', () => {
  test('rejects mixed native-effective and other guards before authentication or downstream fallback', async ({
    assert,
  }) => {
    for (const guards of [
      ['api', 'web_effective'],
      ['web_effective', 'api'],
      ['web_effective', 'default'],
    ]) {
      for (const missingNativeCredential of [false, true]) {
        const f = fixture()
        const service = await f.create()
        const mode = await service.status({})
        if (missingNativeCredential)
          f.dependencies.authenticateActor = async () => {
            throw new errors.E_UNAUTHORIZED_ACCESS('Native session missing', {
              guardDriverName: 'session',
            })
          }
        const before = f.state.authenticateCount
        const { ctx, responseState } = requestContext(f, {
          body: { _masqueradeContext: mode.contextToken },
          routeMiddleware: [{ name: 'auth', args: { guards } }],
        })
        let downstreamCalls = 0
        await handleWithDefaultExceptionHandler(ctx, () =>
          masqueradeContext(ctx, async () => {
            downstreamCalls++
          })
        )
        assert.equal(responseState.status, 503)
        assert.equal(downstreamCalls, 0)
        assert.equal(f.state.authenticateCount, before)
      }
    }
  })

  test('defers native authentication rendering to named auth without retrying downstream errors', async ({
    assert,
  }) => {
    const f = fixture()
    f.dependencies.authenticateActor = async () => {
      throw new errors.E_UNAUTHORIZED_ACCESS('Raw session missing', { guardDriverName: 'session' })
    }
    let reads = 0
    f.store.read = async () => {
      reads++
      return null
    }
    const { ctx, responseState } = requestContext(f, { method: 'GET' })
    let downstreamCalls = 0
    await assert.rejects(
      () =>
        masqueradeContext(ctx, async () => {
          downstreamCalls++
          throw new errors.E_UNAUTHORIZED_ACCESS('Named auth chooses rendering', {
            guardDriverName: 'session',
          })
        }),
      'Named auth chooses rendering'
    )
    assert.equal(downstreamCalls, 1)
    assert.equal(reads, 0)
    assert.equal(responseState.headers.get('cache-control'), 'no-store')
  })

  test('requires context on idle unsafe routes in report mode and ignores query state', async ({
    assert,
  }) => {
    const f = fixture()
    f.config.contextEnforcement = 'report'
    const { ctx, warnings } = requestContext(f, { body: {} })
    let continued = false
    await masqueradeContext(ctx, async () => {
      continued = true
    })
    assert.isTrue(continued)
    assert.equal((warnings[0] as { code: string }).code, 'E_MASQUERADE_CONTEXT_REQUIRED')
  })

  test('reports header and form token disagreement as stale context', async ({ assert }) => {
    const f = fixture()
    f.config.contextEnforcement = 'report'
    const service = await f.create()
    const mode = await service.status({})
    const { ctx, warnings } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken },
      header: `1.${'a'.repeat(32)}`,
    })
    let continued = false
    await masqueradeContext(ctx, async () => {
      continued = true
    })
    assert.isTrue(continued)
    assert.equal((warnings[0] as { code: string }).code, 'E_MASQUERADE_CONTEXT_CHANGED')
  })

  test('does not apply the control-body limit to covered business requests', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    const mode = await service.status({})
    const payload = 'x'.repeat(9000)
    const { ctx } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken, payload },
    })
    let continued = false
    await masqueradeContext(ctx, async () => {
      continued = true
    })
    assert.isTrue(continued)
  })

  test('blocked responses carry blockedBy and other codes do not', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service, {}, 'edit')
    const mode = await service.status({})
    const { ctx, responseState } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken },
    })
    let continued = false
    const cause: MasqueradeBlockedBy = 'mutation_not_allowed'
    try {
      await masqueradeContext(ctx, async () => {
        continued = true
      })
    } catch (error) {
      if (!(error instanceof MasqueradeError)) throw error
      error.handle(error, ctx)
    }
    assert.isFalse(continued)
    assert.equal(responseState.status, 403)
    assert.deepEqual(responseState.json, {
      errors: [
        {
          code: 'E_MASQUERADE_ACTION_BLOCKED',
          message: 'Action is blocked while masquerading',
          blockedBy: cause,
        },
      ],
    })
    assert.equal(responseState.headers.get('cache-control'), 'no-store')

    const { ctx: sensitiveRoute, responseState: sensitiveResponse } = requestContext(f, {
      method: 'GET',
      routeMiddleware: [{ name: 'auth', args: [{ guards: ['web_effective'] }] }, sensitive()],
    })
    await handleWithDefaultExceptionHandler(sensitiveRoute, () =>
      masqueradeContext(sensitiveRoute, async () => {})
    )
    assert.deepEqual(sensitiveResponse.json, {
      errors: [
        {
          code: 'E_MASQUERADE_ACTION_BLOCKED',
          message: 'Action is blocked while masquerading',
          blockedBy: 'sensitive',
        },
      ],
    })
  })

  test('passes business context errors to the host exception handler', async ({ assert }) => {
    const f = fixture()
    const { ctx, responseState } = requestContext(f, { body: {} })
    let continued = false
    let received: unknown

    try {
      await masqueradeContext(ctx, async () => {
        continued = true
      })
    } catch (error) {
      received = error
    }

    assert.isFalse(continued)
    assert.instanceOf(received, MasqueradeError)
    assert.equal((received as MasqueradeError).code, 'E_MASQUERADE_CONTEXT_REQUIRED')
    ;(received as MasqueradeError).handle(received, ctx)
    assert.deepEqual(responseState.json, {
      errors: [{ code: 'E_MASQUERADE_CONTEXT_REQUIRED', message: 'Masquerade context required' }],
    })
    assert.equal(responseState.headers.get('cache-control'), 'no-store')
  })

  test('view mode blocks unsafe requests on allowMutation routes with view_only', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const mode = await service.status({})
    const { ctx, responseState } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken },
      routeMiddleware: [{ name: 'auth', args: [{ guards: ['web_effective'] }] }, allowMutation()],
    })
    await handleWithDefaultExceptionHandler(ctx, () => masqueradeContext(ctx, async () => {}))
    assert.equal(responseBlockedBy(responseState.json), 'view_only')
    assert.deepEqual(responseState.json, {
      errors: [
        {
          code: 'E_MASQUERADE_ACTION_BLOCKED',
          message: 'Action is blocked while masquerading',
          blockedBy: 'view_only',
        },
      ],
    })
  })

  test('view mode blocks unsafe requests on unmarked routes with view_only, not mutation_not_allowed', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const mode = await service.status({})
    const { ctx, responseState } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken },
    })
    await handleWithDefaultExceptionHandler(ctx, () => masqueradeContext(ctx, async () => {}))
    assert.equal(responseBlockedBy(responseState.json), 'view_only')
  })

  test('an admitted context without access, and one with an unknown value, is blocked with view_only', async ({
    assert,
  }) => {
    for (const access of [undefined, 'unknown']) {
      const f = fixture()
      const service = await f.create()
      await f.start(service)
      const mode = await service.status({})
      const { ctx, responseState } = requestContext(f, {
        body: { _masqueradeContext: mode.contextToken },
        admit: overrideAdmissionAccess(access),
      })
      await handleWithDefaultExceptionHandler(ctx, () => masqueradeContext(ctx, async () => {}))
      assert.equal(responseBlockedBy(responseState.json), 'view_only')
    }
  })

  test('view mode admits GET, HEAD and OPTIONS', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { ctx, responseState } = requestContext(f, { method })
      let continued = false
      await handleWithDefaultExceptionHandler(ctx, () =>
        masqueradeContext(ctx, async () => {
          continued = true
        })
      )
      assert.isTrue(continued, `${method} should continue in view mode`)
      assert.isUndefined(responseState.json)
    }
  })

  test('edit mode without allowMutation is mutation_not_allowed', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service, {}, 'edit')
    const mode = await service.status({})
    const { ctx, responseState } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken },
    })
    await handleWithDefaultExceptionHandler(ctx, () => masqueradeContext(ctx, async () => {}))
    assert.equal(responseBlockedBy(responseState.json), 'mutation_not_allowed')
  })

  test('edit mode with allowMutation reaches the handler under the target', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service, {}, 'edit')
    const mode = await service.status({})
    const { ctx } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken },
      routeMiddleware: [{ name: 'auth', args: [{ guards: ['web_effective'] }] }, allowMutation()],
    })
    let continued = false
    await handleWithDefaultExceptionHandler(ctx, () =>
      masqueradeContext(ctx, async () => {
        continued = true
      })
    )
    assert.isTrue(continued)
    const resolved = await service.resolve({})
    assert.equal(resolved.effectiveId, 'b')
  })

  test('sensitive blocks every method in both levels', async ({ assert }) => {
    for (const access of ['view', 'edit'] as const) {
      for (const method of ['GET', 'POST']) {
        const f = fixture()
        const service = await f.create()
        await f.start(service, {}, access)
        const mode = await service.status({})
        const { ctx, responseState } = requestContext(f, {
          method,
          body: method === 'POST' ? { _masqueradeContext: mode.contextToken } : {},
          routeMiddleware: [
            { name: 'auth', args: [{ guards: ['web_effective'] }] },
            sensitive(),
            allowMutation(),
          ],
        })
        await handleWithDefaultExceptionHandler(ctx, () => masqueradeContext(ctx, async () => {}))
        assert.equal(responseBlockedBy(responseState.json), 'sensitive')
      }
    }
  })

  test('context token errors take precedence over the access rule', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    for (const [token, status, code] of [
      [undefined, 428, 'E_MASQUERADE_CONTEXT_REQUIRED'],
      [`1.${'a'.repeat(32)}`, 409, 'E_MASQUERADE_CONTEXT_CHANGED'],
    ] as const) {
      const { ctx, responseState } = requestContext(f, {
        body: token === undefined ? {} : { _masqueradeContext: token },
      })
      await handleWithDefaultExceptionHandler(ctx, () => masqueradeContext(ctx, async () => {}))
      assert.equal(responseState.status, status)
      assert.equal(errorCode(responseState.json), code)
      assert.isFalse(hasBlockedBy(responseState.json))
    }
  })

  test('report mode still applies the access rule', async ({ assert }) => {
    const f = fixture()
    f.config.contextEnforcement = 'report'
    const service = await f.create()
    await f.start(service)
    const { ctx, responseState, warnings } = requestContext(f, {})
    await handleWithDefaultExceptionHandler(ctx, () => masqueradeContext(ctx, async () => {}))
    assert.equal((warnings[0] as { code: string }).code, 'E_MASQUERADE_CONTEXT_REQUIRED')
    assert.equal(responseBlockedBy(responseState.json), 'view_only')
  })

  test('inherited group allowMutation behaves like a route marker', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service, {}, 'edit')
    const mode = await service.status({})
    const { ctx } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken },
      groupMiddleware: [allowMutation()],
    })
    let continued = false
    await handleWithDefaultExceptionHandler(ctx, () =>
      masqueradeContext(ctx, async () => {
        continued = true
      })
    )
    assert.isTrue(continued)
  })

  test('skips explicit raw-guard routes without reading masquerade state', async ({ assert }) => {
    const f = fixture()
    let storeReads = 0
    const read = f.store.read.bind(f.store)
    f.store.read = async (owner) => {
      storeReads++
      return read(owner)
    }
    const { ctx } = requestContext(f, {
      routeMiddleware: [{ name: 'auth', args: { guards: ['web'] } }],
    })
    let runtimeCalls = 0
    ;(
      ctx as { containerResolver: { make(name: string): Promise<unknown> } }
    ).containerResolver.make = async () => {
      runtimeCalls++
      return {
        effectiveGuardName: 'web_effective',
        effectiveGuardNames: ['web_effective'],
      }
    }
    let continued = false
    await masqueradeContext(ctx, async () => {
      continued = true
    })
    assert.isTrue(continued)
    assert.equal(runtimeCalls, 1)
    assert.equal(storeReads, 0)
  })

  test('enforces routes using an alias of the effective session guard', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    await f.start(service)
    const mode = await service.status({})
    const { ctx, responseState } = requestContext(f, {
      body: { _masqueradeContext: mode.contextToken },
      routeMiddleware: [{ name: 'auth', args: { guards: ['web_alias'] } }],
    })
    let continued = false
    await handleWithDefaultExceptionHandler(ctx, () =>
      masqueradeContext(ctx, async () => {
        continued = true
      })
    )
    assert.isFalse(continued)
    assert.equal(responseState.status, 403)
  })
})

async function handleWithDefaultExceptionHandler(
  ctx: Parameters<typeof masqueradeContext>[0],
  operation: () => Promise<void>
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if (!(error instanceof MasqueradeError)) throw error
    error.handle(error, ctx)
  }
}

function responseBlockedBy(response: unknown): MasqueradeBlockedBy | undefined {
  const items = (response as { errors?: { blockedBy?: MasqueradeBlockedBy }[] } | undefined)?.errors
  return items?.[0]?.blockedBy
}

function errorCode(response: unknown): string | undefined {
  return (response as { errors?: { code?: string }[] } | undefined)?.errors?.[0]?.code
}

function hasBlockedBy(response: unknown): boolean {
  const first = (response as { errors?: object[] } | undefined)?.errors?.[0]
  return first !== undefined && 'blockedBy' in first
}

function overrideAdmissionAccess(
  access: string | undefined
): (
  request: object,
  fallback: () => Promise<RequestAdmission<unknown>>
) => Promise<RequestAdmission<unknown>> {
  return async (_request, fallback) => {
    const admitted = await fallback()
    const context = { ...admitted.context }
    if (access === undefined) delete context.access
    else Object.assign(context, { access })
    return Object.freeze({
      ...admitted,
      context: Object.freeze(context),
    }) as RequestAdmission<unknown>
  }
}
