import { test } from '@japa/runner'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import type { HttpContext } from '@adonisjs/core/http'
import { RequestFactory } from '@adonisjs/core/factories/http'
import { fixture } from './helpers/core.js'
import { controlRequestContext as requestContext } from './helpers/http_context.js'
import { MasqueradeController } from '../http/controllers.js'
import { MasqueradeError } from '../src/errors.js'

test.group('masquerade HTTP boundary', () => {
  test('routes malformed control input through core auditing and renders the public error', async ({
    assert,
  }) => {
    const f = fixture()
    const { ctx, responseState } = requestContext(f, {
      body: { targetId: 'b', reason: 'ok', unexpected: true },
    })
    const controller = new MasqueradeController()
    await handleWithDefaultExceptionHandler(ctx, () => controller.start(ctx))
    assert.equal(responseState.status, 422)
    assert.equal(f.store.events.at(-1)?.kind, 'start_denied')
    assert.equal(f.store.events.at(-1)?.outcomeCode, 'E_MASQUERADE_INVALID_INPUT')
    assert.equal(responseState.headers.get('cache-control'), 'no-store')
  })

  test('passes control errors to the host handler and keeps a safe default JSON renderer', async ({
    assert,
  }) => {
    const f = fixture()
    const { ctx, responseState } = requestContext(f, {
      body: { targetId: 'b', reason: 'ok', unexpected: true },
    })
    const controller = new MasqueradeController()
    let received: unknown

    try {
      await controller.start(ctx)
    } catch (error) {
      received = error
    }

    assert.instanceOf(received, MasqueradeError)
    assert.equal((received as MasqueradeError).code, 'E_MASQUERADE_INVALID_INPUT')

    ;(received as MasqueradeError).handle(received, ctx)
    assert.equal(responseState.status, 422)
    assert.deepEqual(responseState.json, {
      errors: [{ code: 'E_MASQUERADE_INVALID_INPUT', message: 'Invalid masquerade input' }],
    })
    assert.equal(responseState.headers.get('cache-control'), 'no-store')
  })

  test('lets a host render a localized control error', async ({ assert }) => {
    const f = fixture()
    const { ctx, responseState } = requestContext(f, {
      body: { targetId: 'b', reason: 'ok', unexpected: true },
    })
    let hostReceived = false
    try {
      await new MasqueradeController().start(ctx)
    } catch (error) {
      if (!(error instanceof MasqueradeError)) throw error
      hostReceived = true
      ;(ctx as HttpContext).response
        .status(error.status)
        .json({ error: 'La requête de contrôle est invalide' })
    }

    assert.isTrue(hostReceived)
    assert.equal(responseState.status, 422)
    assert.deepEqual(responseState.json, { error: 'La requête de contrôle est invalide' })
  })

  test('accepts Shield form transport without treating its CSRF field as package input', async ({
    assert,
  }) => {
    const f = fixture()
    const { ctx, responseState } = requestContext(f, {
      body: { _csrf: 'host-csrf-token' },
      contentType: 'application/x-www-form-urlencoded',
      raw: '_csrf=host-csrf-token',
    })
    await handleWithDefaultExceptionHandler(ctx, () => new MasqueradeController().stop(ctx))
    assert.equal(responseState.status, 428)
    assert.equal(f.store.events.at(-1)?.kind, 'stop_denied')
    assert.equal(f.store.events.at(-1)?.outcomeCode, 'E_MASQUERADE_CONTEXT_REQUIRED')
  })

  test('rejects controls above 8 KiB using the actual URL-encoded wire length', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    const mode = await service.status({})
    const body = { _masqueradeContext: mode.contextToken, _csrf: 'csrf' }
    const { ctx, responseState } = requestContext(f, {
      body,
      contentType: 'application/x-www-form-urlencoded',
      raw: `%5FmasqueradeContext=${encodeURIComponent(mode.contextToken)}&${'a='.repeat(4300)}`,
    })
    await handleWithDefaultExceptionHandler(ctx, () => new MasqueradeController().stop(ctx))
    assert.equal(responseState.status, 422)
    assert.equal(f.store.events.at(-1)?.kind, 'stop_denied')
    assert.equal(f.store.events.at(-1)?.outcomeCode, 'E_MASQUERADE_INVALID_INPUT')
  })

  test('accepts an empty header-only stop request', async ({ assert }) => {
    const f = fixture()
    const service = await f.create()
    const mode = await service.status({})
    const { ctx, responseState } = requestContext(f, {
      method: 'POST',
      body: {},
      raw: null,
      contentLength: '0',
      header: mode.contextToken,
    })
    await new MasqueradeController().stop(ctx)
    assert.equal(responseState.status, 200)
    assert.isFalse((responseState.json as { isMasquerading: boolean }).isMasquerading)
  })

  test('accepts canonical form duration strings but keeps JSON number validation strict', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    const mode = await service.status({})
    const form = {
      targetId: 'b',
      reason: 'support',
      durationSeconds: '900',
      _masqueradeContext: mode.contextToken,
    }
    const formRaw = new URLSearchParams(form).toString()
    const { ctx: formRequest, responseState: formResponse } = requestContext(f, {
      body: form,
      contentType: 'application/x-www-form-urlencoded',
      raw: formRaw,
    })
    await new MasqueradeController().start(formRequest)
    assert.equal(formResponse.status, 200)
    assert.equal(
      Date.parse((formResponse.json as { expiresAt: string }).expiresAt) - f.state.now,
      900_000
    )

    const jsonFixture = fixture()
    const jsonService = await jsonFixture.create()
    const jsonMode = await jsonService.status({})
    const { ctx: jsonRequest, responseState: jsonResponse } = requestContext(jsonFixture, {
      body: { ...form, _masqueradeContext: jsonMode.contextToken },
      contentType: 'application/json',
    })
    await handleWithDefaultExceptionHandler(jsonRequest, () =>
      new MasqueradeController().start(jsonRequest)
    )
    assert.equal(jsonResponse.status, 422)
    assert.equal(jsonFixture.store.events.at(-1)?.outcomeCode, 'E_MASQUERADE_INVALID_INPUT')

    const noncanonicalFixture = fixture()
    const noncanonicalService = await noncanonicalFixture.create()
    const noncanonicalMode = await noncanonicalService.status({})
    const noncanonical = {
      ...form,
      durationSeconds: '0900',
      _masqueradeContext: noncanonicalMode.contextToken,
    }
    const { ctx: noncanonicalRequest, responseState: noncanonicalResponse } = requestContext(
      noncanonicalFixture,
      {
        body: noncanonical,
        contentType: 'application/x-www-form-urlencoded',
        raw: new URLSearchParams(noncanonical).toString(),
      }
    )
    await handleWithDefaultExceptionHandler(noncanonicalRequest, () =>
      new MasqueradeController().start(noncanonicalRequest)
    )
    assert.equal(noncanonicalResponse.status, 422)
    assert.equal(noncanonicalFixture.store.events.at(-1)?.outcomeCode, 'E_MASQUERADE_INVALID_INPUT')
  })

  test('start accepts access in JSON and form bodies and rejects unknown values through the audit boundary', async ({
    assert,
  }) => {
    const jsonFixture = fixture()
    const jsonService = await jsonFixture.create()
    const jsonMode = await jsonService.status({})
    const jsonBody = {
      targetId: 'b',
      reason: 'support',
      access: 'edit',
      _masqueradeContext: jsonMode.contextToken,
    }
    const { ctx: jsonRequest, responseState: jsonResponse } = requestContext(jsonFixture, {
      body: jsonBody,
      contentType: 'application/json',
    })
    await handleWithDefaultExceptionHandler(jsonRequest, () =>
      new MasqueradeController().start(jsonRequest)
    )
    assert.equal(jsonResponse.status, 200)
    const jsonRow = await jsonFixture.store.read(jsonFixture.owner)
    assert.equal(jsonRow?.access, 'edit')

    const formFixture = fixture()
    const formService = await formFixture.create()
    const formMode = await formService.status({})
    const formBody = {
      targetId: 'b',
      reason: 'support',
      access: 'edit',
      _masqueradeContext: formMode.contextToken,
    }
    const { ctx: formRequest, responseState: formResponse } = requestContext(formFixture, {
      body: formBody,
      contentType: 'application/x-www-form-urlencoded',
      raw: new URLSearchParams(formBody).toString(),
    })
    await handleWithDefaultExceptionHandler(formRequest, () =>
      new MasqueradeController().start(formRequest)
    )
    assert.equal(formResponse.status, 200)
    const formRow = await formFixture.store.read(formFixture.owner)
    assert.equal(formRow?.access, 'edit')

    const invalidFixture = fixture()
    const invalidService = await invalidFixture.create()
    const invalidMode = await invalidService.status({})
    const invalidBody = {
      targetId: 'b',
      reason: 'support',
      access: 'full',
      _masqueradeContext: invalidMode.contextToken,
    }
    const { ctx: invalidRequest, responseState: invalidResponse } = requestContext(invalidFixture, {
      body: invalidBody,
      contentType: 'application/x-www-form-urlencoded',
      raw: new URLSearchParams(invalidBody).toString(),
    })
    await handleWithDefaultExceptionHandler(invalidRequest, () =>
      new MasqueradeController().start(invalidRequest)
    )
    assert.equal(invalidResponse.status, 422)
    assert.equal(invalidFixture.store.events.at(-1)?.kind, 'start_denied')
    assert.equal(invalidFixture.store.events.at(-1)?.outcomeCode, 'E_MASQUERADE_INVALID_INPUT')
  })

  test('does not treat chunked unsupported-content bodies as empty stop requests', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    const mode = await service.status({})
    const { ctx, responseState } = requestContext(f, {
      body: {},
      raw: null,
      hasBody: true,
      contentLength: null,
      contentType: 'text/plain',
      header: mode.contextToken,
    })
    await handleWithDefaultExceptionHandler(ctx, () => new MasqueradeController().stop(ctx))
    assert.equal(responseState.status, 422)
    assert.equal(f.store.events.at(-1)?.outcomeCode, 'E_MASQUERADE_INVALID_INPUT')
  })

  test('returns unavailable when recording an invalid-control audit fails', async ({ assert }) => {
    const f = fixture()
    f.store.recordControlOutcome = async () => {
      throw new Error('audit unavailable')
    }
    const { ctx, responseState } = requestContext(f, { body: { unexpected: true } })
    await handleWithDefaultExceptionHandler(ctx, () => new MasqueradeController().start(ctx))
    assert.equal(responseState.status, 503)
    assert.deepEqual(responseState.json, {
      errors: [{ code: 'E_MASQUERADE_UNAVAILABLE', message: 'Masquerade is unavailable' }],
    })
  })

  test('accepts Content-Length zero using the native request body detection', async ({
    assert,
  }) => {
    const f = fixture()
    const service = await f.create()
    const mode = await service.status({})
    const { ctx, responseState } = requestContext(f, {})
    const incoming = new IncomingMessage(new Socket())
    incoming.headers = { 'content-length': '0', 'x-masquerade-context': mode.contextToken }
    const request = new RequestFactory().merge({ req: incoming, method: 'POST' }).create()
    request.updateBody({})
    assert.isTrue(request.hasBody())
    Object.defineProperty(ctx, 'request', { value: request })
    await new MasqueradeController().stop(ctx)
    assert.equal(responseState.status, 200)
    assert.equal(f.store.events[0].kind, 'control_noop')

    const chunked = new IncomingMessage(new Socket())
    chunked.headers = {
      'transfer-encoding': 'chunked',
      'content-type': 'application/octet-stream',
      'x-masquerade-context': mode.contextToken,
    }
    const chunkedRequest = new RequestFactory().merge({ req: chunked, method: 'POST' }).create()
    chunkedRequest.updateBody({})
    assert.isTrue(chunkedRequest.hasBody())
    const rejected = requestContext(f, {})
    Object.defineProperty(rejected.ctx, 'request', { value: chunkedRequest })
    await handleWithDefaultExceptionHandler(rejected.ctx, () =>
      new MasqueradeController().stop(rejected.ctx)
    )
    assert.equal(rejected.responseState.status, 422)
    assert.equal(f.store.events[1].kind, 'stop_denied')
  })
})

async function handleWithDefaultExceptionHandler(
  ctx: Parameters<MasqueradeController['start']>[0],
  operation: () => Promise<void>
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if (!(error instanceof MasqueradeError)) throw error
    error.handle(error, ctx)
  }
}
