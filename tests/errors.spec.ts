import { test } from '@japa/runner'
import { Exception, RuntimeException } from '@adonisjs/core/exceptions'
import type { MasqueradeBlockedBy } from '../index.js'
import { MasqueradeError, MasqueradeSetupError } from '../src/errors.js'
import { fixture } from './helpers/core.js'
import { requestContext } from './helpers/http_context.js'

const allowedBlock: MasqueradeBlockedBy = 'view_only'
void allowedBlock
const allBlockedByValues: MasqueradeBlockedBy[] = ['sensitive', 'view_only', 'mutation_not_allowed']
void allBlockedByValues

// Type-only: the constructor also throws at runtime without a cause (tested below).
void (() => {
  // @ts-expect-error Every blocked action needs a cause.
  new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED')
})
// @ts-expect-error Other error codes do not accept blockedBy options.
new MasqueradeError('E_MASQUERADE_NOT_ALLOWED', { blockedBy: 'sensitive' })
const blockedError = new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED', {
  blockedBy: 'sensitive',
})
// @ts-expect-error blockedBy is readonly.
blockedError.blockedBy = 'view_only'

test.group('MasqueradeError', () => {
  test('a blocked action without a known cause is a programming error', ({ assert }) => {
    for (const options of [undefined, {}, { blockedBy: 'other' }])
      assert.throws(
        () => new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED', options as never),
        'E_MASQUERADE_ACTION_BLOCKED requires blockedBy'
      )
  })

  test('falls back to English when ctx.i18n is present but unset', ({ assert }) => {
    const error = new MasqueradeError('E_MASQUERADE_NOT_ALLOWED')
    assert.equal(error.getResponseMessage({ i18n: undefined } as never), error.message)
  })

  test('uses the Adonis exception base and exposes a stable identifier', ({ assert }) => {
    const error = new MasqueradeError('E_MASQUERADE_NOT_ALLOWED')

    assert.instanceOf(error, Exception)
    assert.equal(error.identifier, 'errors.E_MASQUERADE_NOT_ALLOWED')
    assert.equal(error.status, 403)
    assert.equal(error.code, 'E_MASQUERADE_NOT_ALLOWED')
  })

  test('uses the Adonis runtime exception base for setup errors', ({ assert }) => {
    const setupError = new MasqueradeSetupError('E_MASQUERADE_INVALID_CONFIGURATION', 'config')

    assert.instanceOf(setupError, RuntimeException)
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
    const error = new MasqueradeError('E_MASQUERADE_CONTEXT_REQUIRED')
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
    new MasqueradeError('E_MASQUERADE_CONTEXT_REQUIRED').handle(undefined, ctx)
    assert.deepEqual(responseState.json, {
      errors: [{ code: 'E_MASQUERADE_CONTEXT_REQUIRED', message: 'Masquerade context required' }],
    })
  })

  test('includes the blocked cause and preserves no-store cache headers', ({ assert }) => {
    const { ctx, responseState } = requestContext(fixture(), {})
    const error = new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED', {
      blockedBy: 'mutation_not_allowed',
    })

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
    const error = new MasqueradeError('E_MASQUERADE_CONTEXT_REQUIRED')
    Object.defineProperty(error, 'blockedBy', { value: 'sensitive' })
    error.handle(error, ctx)

    assert.deepEqual(responseState.json, {
      errors: [{ code: 'E_MASQUERADE_CONTEXT_REQUIRED', message: 'Masquerade context required' }],
    })
    assert.equal(responseState.headers.get('cache-control'), 'no-store')
    assert.equal('blockedBy' in (responseState.json as { errors: object[] }).errors[0]!, false)
  })
})
