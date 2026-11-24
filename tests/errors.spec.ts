import { test } from '@japa/runner'
import { Exception, RuntimeException } from '@adonisjs/core/exceptions'
import { errors } from '../index.js'
import { isMasqueradeRequestError } from '../http/main.js'
import { fixture } from './helpers/core.js'
import { requestContext } from './helpers/http_context.js'

test.group('Masquerade exceptions', () => {
  test('falls back to English when ctx.i18n is present but unset', ({ assert }) => {
    const error = new errors.E_MASQUERADE_TOKEN_ABILITY_REQUIRED()
    assert.equal(error.getResponseMessage({ i18n: undefined } as never), error.message)
  })

  test('uses the Adonis exception base and exposes a stable identifier', ({ assert }) => {
    const error = new errors.E_MASQUERADE_TOKEN_ABILITY_REQUIRED()

    assert.instanceOf(error, Exception)
    assert.isTrue(isMasqueradeRequestError(error))
    assert.isFalse(isMasqueradeRequestError(new RuntimeException()))
    assert.isFalse(isMasqueradeRequestError({ code: error.code }))
    assert.equal(error.identifier, 'errors.E_MASQUERADE_TOKEN_ABILITY_REQUIRED')
    assert.equal(error.status, 403)
    assert.equal(error.code, 'E_MASQUERADE_TOKEN_ABILITY_REQUIRED')
  })

  test('exposes a distinct constructor with the previous code, status and fallback for each cause', ({
    assert,
  }) => {
    const cases = [
      [
        new errors.E_MASQUERADE_UNAUTHENTICATED(),
        'E_MASQUERADE_UNAUTHENTICATED',
        401,
        'Actor authentication required',
      ],
      [
        new errors.E_MASQUERADE_TOKEN_ABILITY_REQUIRED(),
        'E_MASQUERADE_TOKEN_ABILITY_REQUIRED',
        403,
        'The token lacks the ability required to control masquerade',
      ],
      [
        new errors.E_MASQUERADE_ACTION_BLOCKED('sensitive'),
        'E_MASQUERADE_ACTION_BLOCKED',
        403,
        'Action is blocked while masquerading',
      ],
      [
        new errors.E_MASQUERADE_ALREADY_ACTIVE(),
        'E_MASQUERADE_ALREADY_ACTIVE',
        409,
        'Masquerade is already active',
      ],
      [
        new errors.E_MASQUERADE_CONTEXT_CHANGED(),
        'E_MASQUERADE_CONTEXT_CHANGED',
        409,
        'Masquerade context changed',
      ],
      [
        new errors.E_MASQUERADE_INVALID_INPUT(),
        'E_MASQUERADE_INVALID_INPUT',
        422,
        'Invalid masquerade input',
      ],
      [
        new errors.E_MASQUERADE_CONTEXT_REQUIRED(),
        'E_MASQUERADE_CONTEXT_REQUIRED',
        428,
        'Masquerade context required',
      ],
      [
        new errors.E_MASQUERADE_STORE_OPEN_FAILED(),
        'E_MASQUERADE_STORE_OPEN_FAILED',
        503,
        'The masquerade store could not be opened',
      ],
    ] as const
    assert.equal(new Set(cases.map(([error]) => error.constructor)).size, cases.length)
    for (const [error, code, status, message] of cases) {
      assert.equal(error.constructor, errors[code])
      assert.equal(error.code, code)
      assert.equal(error.status, status)
      assert.equal(error.message, message)
    }
  })

  test('each exported constructor exposes its own raw code and status', ({ assert }) => {
    const argumentsByCode = {
      E_MASQUERADE_ACTION_BLOCKED: ['sensitive'],
      E_MASQUERADE_INVALID_CONFIGURATION: ['config'],
      E_MASQUERADE_INVALID_STORE: ['store'],
      E_MASQUERADE_STOP_PROGRESS: ['stop_commit', 0, new errors.E_MASQUERADE_UNKNOWN_COMMIT()],
      E_MASQUERADE_PRUNE_PROGRESS: ['expiry_commit', { expired: 0, eventsDeleted: 0 }, true],
    } satisfies {
      [Code in keyof typeof errors]?: ConstructorParameters<(typeof errors)[Code]>
    }

    for (const [code, ExceptionClass] of Object.entries(errors)) {
      const args = Object.hasOwn(argumentsByCode, code)
        ? argumentsByCode[code as keyof typeof argumentsByCode]
        : []
      const error = Reflect.construct(ExceptionClass, args) as InstanceType<typeof ExceptionClass>
      assert.equal(error.constructor, ExceptionClass)
      assert.equal(ExceptionClass.code, code)
      assert.equal(error.code, code)
      assert.equal(error.status, ExceptionClass.status)
    }
  })

  test('a cause object cannot change the exception metadata or leak into the response', ({
    assert,
  }) => {
    const cause = { code: 'private-code', status: 418, message: 'private detail' }
    const failure = new errors.E_MASQUERADE_STORE_READ_FAILED(cause)
    const { ctx, responseState } = requestContext(fixture(), {})
    failure.handle(failure, ctx)
    assert.strictEqual(failure.cause, cause)
    assert.equal(failure.code, 'E_MASQUERADE_STORE_READ_FAILED')
    assert.equal(failure.status, 503)
    assert.deepEqual(responseState.json, {
      errors: [
        {
          code: 'E_MASQUERADE_STORE_READ_FAILED',
          message: 'The masquerade store could not read a mode',
        },
      ],
    })
  })

  test('start refusal reasons render one eligibility denial', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    const idle = await service.status({})
    for (const [targetId, expected] of [
      ['missing', errors.E_MASQUERADE_TARGET_INELIGIBLE],
      ['b', errors.E_MASQUERADE_START_DENIED],
    ] as const) {
      f.state.policy = false
      const failure = await service
        .start({}, { targetId, expectedContext: idle.contextToken })
        .catch((error: unknown) => error)
      assert.instanceOf(failure, expected)
      const { ctx, responseState } = requestContext(f, {})
      assert.isTrue(isMasqueradeRequestError(failure))
      if (!isMasqueradeRequestError(failure)) throw failure
      failure.handle(failure, ctx)
      assert.equal(responseState.status, 403)
      assert.deepEqual(responseState.json, {
        errors: [{ code: 'E_MASQUERADE_NOT_ALLOWED', message: 'Masquerade is not allowed' }],
      })
      assert.equal(f.store.events.at(-1)?.outcomeCode, expected.code)
      assert.notProperty(f.store.events.at(-1), 'targetIncarnation')
    }
  })

  test('uses the Adonis runtime exception base for setup errors', ({ assert }) => {
    const setupError = new errors.E_MASQUERADE_INVALID_CONFIGURATION('config')

    assert.instanceOf(setupError, RuntimeException)
    assert.isFalse(isMasqueradeRequestError(setupError))
    assert.isFalse(setupError instanceof TypeError)
  })

  test('looks up a stable code with the English fallback even after error fields change', ({
    assert,
  }) => {
    const { ctx, responseState } = requestContext(fixture(), {})
    let lookup: { id: string; fallback: string } | undefined
    ;(ctx as unknown as { i18n: unknown }).i18n = {
      t: (id: string, _data: Record<string, unknown>, fallback: string) => {
        lookup = { id, fallback }
        return 'translated'
      },
    }
    const error = new errors.E_MASQUERADE_CONTEXT_REQUIRED()
    Object.defineProperty(error, 'identifier', { value: 'errors.mutable' })
    error.message = 'mutable message'

    error.handle(error, ctx)

    assert.deepEqual(lookup, {
      id: 'errors.E_MASQUERADE_CONTEXT_REQUIRED',
      fallback: 'Masquerade context required',
    })
    assert.deepEqual(responseState.json, {
      errors: [{ code: 'E_MASQUERADE_CONTEXT_REQUIRED', message: 'translated' }],
    })
  })

  test('uses the English message when the context has no i18n instance', ({ assert }) => {
    const { ctx, responseState } = requestContext(fixture(), {})
    new errors.E_MASQUERADE_CONTEXT_REQUIRED().handle(undefined, ctx)
    assert.deepEqual(responseState.json, {
      errors: [{ code: 'E_MASQUERADE_CONTEXT_REQUIRED', message: 'Masquerade context required' }],
    })
  })

  test('includes the blocked cause and preserves no-store cache headers', ({ assert }) => {
    const { ctx, responseState } = requestContext(fixture(), {})
    const error = new errors.E_MASQUERADE_ACTION_BLOCKED('mutation_not_allowed')

    error.handle(error, ctx)

    assert.deepEqual(responseState.json, {
      errors: [
        {
          code: 'E_MASQUERADE_ACTION_BLOCKED',
          message: 'Action is blocked while masquerading',
          blockedBy: 'mutation_not_allowed',
        },
      ],
    })
    assert.equal(responseState.headers.get('cache-control'), 'no-store')
    assert.deepEqual(responseState.varies, [['Accept', 'X-Masquerade-Context']])
  })

  test('keeps other error payloads unchanged and omits blockedBy', ({ assert }) => {
    const { ctx, responseState } = requestContext(fixture(), {})
    const error = new errors.E_MASQUERADE_CONTEXT_REQUIRED()
    Object.defineProperty(error, 'blockedBy', { value: 'sensitive' })
    error.handle(error, ctx)

    assert.deepEqual(responseState.json, {
      errors: [{ code: 'E_MASQUERADE_CONTEXT_REQUIRED', message: 'Masquerade context required' }],
    })
    assert.equal(responseState.headers.get('cache-control'), 'no-store')
    assert.equal('blockedBy' in (responseState.json as { errors: object[] }).errors[0]!, false)
  })
})
