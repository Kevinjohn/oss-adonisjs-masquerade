import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import { errors } from '../index.js'
import { fixture } from './helpers/core.js'
import { controlRequestContext } from './helpers/http_context.js'
import { handleWithDefaultExceptionHandler } from './helpers/exception_handler.js'
import { MasqueradeController } from '../http/controllers.js'
import { formTokenMutation } from '../bin/helpers/recipe_mutations.js'

const root = process.cwd()

/** Load the generated form controller with its package imports pointed at the source tree. */
async function loadStub(directory: string, broken = false) {
  const stub = await readFile(join(root, 'stubs/configure/form_controller.stub'), 'utf8')
  const source = stub
    .replace(/^\{\{\{[\s\S]*?\}\}\}\n/, '')
    .replace("'@kevinjohn/adonisjs-masquerade/http'", `'${join(root, 'http/main.ts')}'`)
    .replace("'@kevinjohn/adonisjs-masquerade'", `'${join(root, 'index.ts')}'`)
  const file = join(
    directory,
    broken ? 'broken_form_controller.ts' : 'masquerade_form_controller.ts'
  )
  if (broken && source.split(formTokenMutation.original).length !== 2) {
    throw new Error('Expected exactly one form token mutation seam in the generated controller')
  }
  await writeFile(
    file,
    broken ? source.replace(formTokenMutation.original, formTokenMutation.replacement) : source
  )
  const module = await import(pathToFileURL(file).href)
  return module.default
}

function formRequest(runtime: unknown, body: Record<string, unknown>) {
  const state: { flash?: unknown; redirect?: string } = {}
  const raw = new URLSearchParams(
    Object.entries(body).map(([key, value]): [string, string] => [
      key,
      value === null ? '' : String(value),
    ])
  ).toString()
  const headers: Record<string, string> = {
    'accept': 'text/html',
    'content-type': 'application/x-www-form-urlencoded',
  }
  const ctx = {
    containerResolver: { make: async () => runtime },
    request: {
      header: (name: string) => headers[name.toLowerCase()],
      accepts: () => 'html',
      body: () => body,
      updateBody: (value: Record<string, unknown>) => {
        body = value
      },
      raw: () => raw,
      hasBody: () => true,
    },
    response: {
      header() {},
      vary() {},
      redirect: () => ({ toPath: (path: string) => (state.redirect = path) }),
    },
    session: { flash: (value: unknown) => (state.flash = value) },
  }
  return { ctx, state }
}

test.group('generated form controller', (group) => {
  const directory = join(root, 'tmp', `form_controller_stub_${process.pid}`)
  group.setup(async () => {
    await mkdir(directory, { recursive: true })
    return () => rm(directory, { recursive: true, force: true })
  })

  test('refuses to control from a route that is not on a raw guard', async ({ assert }) => {
    const Controller = await loadStub(directory)
    let started = false
    const runtime = {
      selectGuard: () => ({ kind: 'effective', raw: 'web' }),
      service: {
        async start() {
          started = true
        },
      },
    }
    const { ctx, state } = formRequest(runtime, { targetId: 'b', _masqueradeContext: 't' })
    await new Controller().start(ctx)
    assert.isFalse(started)
    assert.deepEqual(state.flash, {
      masquerade: {
        type: 'error',
        code: new errors.E_MASQUERADE_CONTROL_GUARD_REQUIRED().responseCode,
      },
    })
  })

  test('treats blank optional fields as absent so their defaults apply', async ({ assert }) => {
    const Controller = await loadStub(directory)
    const inputs: unknown[] = []
    const runtime = {
      selectGuard: () => ({ kind: 'raw', raw: 'web' }),
      service: {
        async start(_ctx: unknown, input: unknown) {
          inputs.push(input)
        },
      },
    }
    const { ctx, state } = formRequest(runtime, {
      targetId: 'b',
      reason: null,
      durationSeconds: null,
      access: null,
      _masqueradeContext: 't',
    })
    await new Controller().start(ctx)
    assert.deepEqual(inputs, [{ targetId: 'b', reason: null, expectedContext: 't' }])
    assert.deepEqual(state.flash, { masquerade: { type: 'success', action: 'started' } })
  })

  test('the recipe form-token mutant removes the captured token at the generated host boundary', async ({
    assert,
  }) => {
    for (const broken of [false, true]) {
      const f = fixture()
      const service = await f.create()
      const idle = await service.status({})
      const runtime = { service, selectGuard: () => ({ kind: 'raw', raw: 'web' }) }
      const { ctx, state } = formRequest(runtime, {
        targetId: 'b',
        reason: 'support',
        _masqueradeContext: idle.contextToken,
      })
      const Controller = await loadStub(directory, broken)
      await new Controller().start(ctx)
      assert.deepEqual(
        state.flash,
        broken
          ? { masquerade: { type: 'error', code: 'E_MASQUERADE_CONTEXT_REQUIRED' } }
          : { masquerade: { type: 'success', action: 'started' } }
      )
      const status = await service.status({})
      assert.equal(status.isMasquerading, !broken)
      assert.lengthOf(f.store.events, 1)
      assert.equal(f.store.events[0].kind, broken ? 'start_denied' : 'started')
    }
  })

  test('matches JSON refusal precedence and records exactly one denial for malformed forms', async ({
    assert,
  }) => {
    const Controller = await loadStub(directory)
    for (const scenario of [
      {
        active: false,
        token: 'missing',
        fields: { access: 'unknown' },
        status: 428,
        code: 'E_MASQUERADE_CONTEXT_REQUIRED',
      },
      {
        active: false,
        token: 'stale',
        fields: { access: 'unknown' },
        status: 409,
        code: 'E_MASQUERADE_CONTEXT_CHANGED',
      },
      {
        active: false,
        token: 'missing',
        fields: { extra: true },
        status: 422,
        code: 'E_MASQUERADE_INVALID_INPUT',
      },
      {
        active: false,
        token: 'current',
        fields: { access: 'unknown' },
        status: 422,
        code: 'E_MASQUERADE_INVALID_INPUT',
      },
      {
        active: true,
        token: 'current',
        fields: { access: 'unknown' },
        status: 409,
        code: 'E_MASQUERADE_ALREADY_ACTIVE',
      },
    ]) {
      for (const transport of ['html', 'json']) {
        const f = fixture()
        const service = await f.create()
        const mode = scenario.active ? await f.start(service) : await service.status({})
        const before = f.store.events.length
        const body = {
          targetId: 'b',
          reason: 'support',
          ...scenario.fields,
          ...(scenario.token === 'current'
            ? { _masqueradeContext: mode.contextToken }
            : scenario.token === 'stale'
              ? { _masqueradeContext: '0.' + '0'.repeat(32) }
              : {}),
        }
        if (transport === 'html') {
          const runtime = { service, selectGuard: () => ({ kind: 'raw', raw: 'web' }) }
          const { ctx, state } = formRequest(runtime, body)
          await new Controller().start(ctx)
          assert.deepEqual(state.flash, { masquerade: { type: 'error', code: scenario.code } })
          assert.equal(state.redirect, '/')
        } else {
          const { ctx, responseState } = controlRequestContext(f, { body })
          await handleWithDefaultExceptionHandler(ctx, () => new MasqueradeController().start(ctx))
          assert.equal(responseState.status, scenario.status)
          assert.equal(
            (responseState.json as { errors: { code: string }[] }).errors[0].code,
            scenario.code
          )
        }
        assert.lengthOf(f.store.events, before + 1)
        assert.equal(f.store.events.at(-1)?.kind, 'start_denied')
        assert.equal(f.store.events.at(-1)?.outcomeCode, scenario.code)
      }
    }
  })

  test('matches JSON stop refusals and keeps expiry distinct from denied controls', async ({
    assert,
  }) => {
    const Controller = await loadStub(directory)
    for (const scenario of [
      {
        token: 'missing',
        fields: { extra: true },
        status: 422,
        code: 'E_MASQUERADE_INVALID_INPUT',
      },
      { token: 'missing', fields: {}, status: 428, code: 'E_MASQUERADE_CONTEXT_REQUIRED' },
      { token: 'stale', fields: {}, status: 409, code: 'E_MASQUERADE_CONTEXT_CHANGED' },
      { token: 'current', fields: {}, status: 200, code: 'expired' },
    ]) {
      for (const transport of ['html', 'json']) {
        const f = fixture()
        const service = await f.create()
        const active = await f.start(service)
        const before = f.store.events.length
        f.state.now += 60 * 60 * 1000
        const body = {
          ...scenario.fields,
          ...(scenario.token === 'current'
            ? { _masqueradeContext: active.contextToken }
            : scenario.token === 'stale'
              ? { _masqueradeContext: '0.' + '0'.repeat(32) }
              : {}),
        }
        if (transport === 'html') {
          const runtime = { service, selectGuard: () => ({ kind: 'raw', raw: 'web' }) }
          const { ctx, state } = formRequest(runtime, body)
          await new Controller().stop(ctx)
          assert.deepEqual(
            state.flash,
            scenario.status === 200
              ? { masquerade: { type: 'success', action: 'stopped' } }
              : { masquerade: { type: 'error', code: scenario.code } }
          )
          assert.equal(state.redirect, '/')
        } else {
          const { ctx, responseState } = controlRequestContext(f, {
            body,
            raw: JSON.stringify(body),
          })
          await handleWithDefaultExceptionHandler(ctx, () => new MasqueradeController().stop(ctx))
          assert.equal(responseState.status, scenario.status)
          if (scenario.status === 200)
            assert.isFalse((responseState.json as { isMasquerading: boolean }).isMasquerading)
          else
            assert.equal(
              (responseState.json as { errors: { code: string }[] }).errors[0].code,
              scenario.code
            )
        }
        assert.lengthOf(f.store.events, before + 1)
        assert.equal(
          f.store.events.at(-1)?.kind,
          scenario.status === 200 ? 'expired' : 'stop_denied'
        )
        assert.equal(f.store.events.at(-1)?.outcomeCode, scenario.code)
      }
    }
  })

  test('does not record a denial for an indeterminate start commit in either response adapter', async ({
    assert,
  }) => {
    const Controller = await loadStub(directory)
    for (const transport of ['html', 'json']) {
      const f = fixture()
      f.store.compareAndSet = async (input) => ({
        status: 'indeterminate',
        transitionId: input.event.id,
      })
      const service = await f.create()
      const idle = await service.status({})
      const body = { targetId: 'b', reason: 'support', _masqueradeContext: idle.contextToken }
      if (transport === 'html') {
        const runtime = { service, selectGuard: () => ({ kind: 'raw', raw: 'web' }) }
        const { ctx, state } = formRequest(runtime, body)
        await new Controller().start(ctx)
        assert.deepEqual(state.flash, {
          masquerade: { type: 'error', code: 'E_MASQUERADE_UNKNOWN_COMMIT' },
        })
      } else {
        const { ctx, responseState } = controlRequestContext(f, { body })
        await handleWithDefaultExceptionHandler(ctx, () => new MasqueradeController().start(ctx))
        assert.equal(responseState.status, 503)
        assert.deepEqual(responseState.json, {
          errors: [
            {
              code: 'E_MASQUERADE_UNKNOWN_COMMIT',
              message: 'The masquerade transition could not be confirmed',
            },
          ],
        })
      }
      assert.lengthOf(f.store.events, 0)
    }
  })
})
