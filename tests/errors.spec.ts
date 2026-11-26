import { test } from '@japa/runner'
import { Exception, RuntimeException } from '@adonisjs/core/exceptions'
import { errors } from '../index.ts'
import { isMasqueradeRequestError } from '../src/http/main.ts'
import { fixture } from './helpers/core.ts'
import { requestContext } from './helpers/http_context.ts'

test.group('Masquerade exceptions', () => {
  test('falls back to English when ctx.i18n is present but unset', ({ assert }) => {
    const error = new errors.E_MASQUERADE_NOT_ALLOWED()
    assert.equal(error.getResponseMessage({ i18n: undefined } as never), error.message)
  })

  test('uses the AdonisJS exception base and exposes a stable identifier', ({ assert }) => {
    const error = new errors.E_MASQUERADE_NOT_ALLOWED()

    assert.instanceOf(error, Exception)
    assert.isTrue(isMasqueradeRequestError(error))
    assert.isFalse(isMasqueradeRequestError(new RuntimeException()))
    assert.isFalse(isMasqueradeRequestError({ code: error.code }))
    assert.equal(error.identifier, 'errors.E_MASQUERADE_NOT_ALLOWED')
    assert.equal(error.status, 403)
    assert.equal(error.code, 'E_MASQUERADE_NOT_ALLOWED')
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
        new errors.E_MASQUERADE_NOT_ALLOWED(),
        'E_MASQUERADE_NOT_ALLOWED',
        403,
        'Masquerade is not allowed',
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
        new errors.E_MASQUERADE_UNAVAILABLE(),
        'E_MASQUERADE_UNAVAILABLE',
        503,
        'Masquerade is unavailable',
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

  test('uses the AdonisJS runtime exception base for setup errors', ({ assert }) => {
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
