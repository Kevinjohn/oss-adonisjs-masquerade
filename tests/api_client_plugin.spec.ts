import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import type { PluginFn } from '@japa/runner/types'
import { masqueradeApiClient } from '../plugins/api_client.js'

test.group('masqueradeApiClient', (group) => {
  group.setup(() => {
    ;(masqueradeApiClient() as unknown as () => void)()
    return () => {
      ApiClient.clearSetupHooks()
    }
  })

  test('rejects a target without an id', ({ assert }) => {
    const request = new ApiClient('http://127.0.0.1:9').get('/business')
    assert.throws(() => request.masquerading({} as never), 'requires a target with an id')
    assert.throws(() => request.masquerading(''), 'requires a target with an id')
  })

  test('fails before sending when the request has no loginAs actor', async ({ assert }) => {
    await assert.rejects(async () => {
      await new ApiClient('http://127.0.0.1:9').get('/business').masquerading('7')
    }, /requires loginAs\(\) on the same request/)
  })

  test('is a Japa plugin function', ({ assert }) => {
    const plugin: PluginFn = masqueradeApiClient({ prefix: '/api/masquerade' })
    assert.isFunction(plugin)
  })

  test('sends the started token unless the test set its own, and stops afterwards', async ({
    assert,
  }) => {
    await withControlServer(async (server) => {
      await authed(new ApiClient(server.url).post('/business')).masquerading('7')
      assert.equal(server.businessToken, 'started')
      assert.isFalse(server.active)

      await authed(new ApiClient(server.url).post('/business'))
        .header('X-Masquerade-Context', 'stale')
        .masquerading('7')
      assert.equal(server.businessToken, 'stale')
      assert.isFalse(server.active)
    })
  })

  test('teardown tolerates an operator the request removed', async ({ assert }) => {
    await withControlServer(async (server) => {
      server.removeOperatorOnBusiness = true
      await authed(new ApiClient(server.url).post('/business')).masquerading('7')
      assert.equal(server.businessToken, 'started')
    })
  })
})

type ControlServer = {
  url: string
  active: boolean
  businessToken?: string
  removeOperatorOnBusiness: boolean
}

function authed<Request extends object>(request: Request): Request {
  return Object.assign(request, { authData: { guard: 'web' } })
}

async function withControlServer(run: (server: ControlServer) => Promise<void>) {
  const state: ControlServer = { url: '', active: false, removeOperatorOnBusiness: false }
  let removed = false
  const http = createServer((request, response) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    request.resume()
    request.on('end', () => {
      if (removed) return json(401, { errors: [{ message: 'Unauthorized access' }] })
      if (request.url === '/masquerade' && request.method === 'GET')
        return json(200, {
          isMasquerading: state.active,
          contextToken: state.active ? 'started' : 'idle',
        })
      if (request.url === '/masquerade/start') {
        state.active = true
        return json(200, { isMasquerading: true, contextToken: 'started' })
      }
      if (request.url === '/masquerade/stop') {
        state.active = false
        return json(200, { isMasquerading: false, contextToken: 'idle' })
      }
      state.businessToken = request.headers['x-masquerade-context'] as string | undefined
      if (state.removeOperatorOnBusiness) removed = true
      return json(200, {})
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  try {
    await run(state)
  } finally {
    await new Promise((resolve) => http.close(resolve))
  }
}
