import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import { MasqueradeError } from '../src/errors.js'

const root = process.cwd()

/** Load the generated form controller with its package imports pointed at the source tree. */
async function loadStub(directory: string) {
  const stub = await readFile(join(root, 'stubs/configure/form_controller.stub'), 'utf8')
  const source = stub
    .replace(/^\{\{\{[\s\S]*?\}\}\}\n/, '')
    .replace("'@kevinjohn/adonisjs-masquerade/http'", `'${join(root, 'http/main.ts')}'`)
    .replace("'@kevinjohn/adonisjs-masquerade'", `'${join(root, 'index.ts')}'`)
  const file = join(directory, 'masquerade_form_controller.ts')
  await writeFile(file, source)
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
      masquerade: { type: 'error', code: new MasqueradeError('E_MASQUERADE_UNAVAILABLE').code },
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
})
