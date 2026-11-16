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
    for (const id of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.throws(() => request.masquerading(id), 'requires a target with an id')
    }
  })

  test('preserves accepted string, safe integer and bigint IDs', async ({ assert }) => {
    await withControlServer(async (server) => {
      for (const [id, expected] of [
        ['NaN', 'NaN'],
        ['Infinity', 'Infinity'],
        ['1.5', '1.5'],
        [Number.MIN_SAFE_INTEGER, String(Number.MIN_SAFE_INTEGER)],
        [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)],
        [10n ** 254n, String(10n ** 254n)],
      ] as const) {
        await authed(new ApiClient(server.url).post('/business')).masquerading(id)
        assert.equal(server.startTargetId, expected)
      }
    })
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

  test('does not send the business request when start reports an idle mode', async ({ assert }) => {
    await withControlServer(async (server) => {
      server.idleStartResponse = true
      await assert.rejects(
        () => authed(new ApiClient(server.url).post('/business')).masquerading('7'),
        /masquerading\(\) start control returned 200/
      )
      assert.equal(server.businessRequests, 0)
    })
  })

  test('reports a stop response that still says the mode is active', async ({ assert }) => {
    await withControlServer(async (server) => {
      server.activeStopResponse = true
      await assert.rejects(
        () => authed(new ApiClient(server.url).post('/business')).masquerading('7'),
        /masquerading\(\) stop control returned 200/
      )
      assert.equal(server.businessRequests, 1)
    })
  })

  test('leaves a replacement mode active during teardown', async ({ assert }) => {
    await withControlServer(async (server) => {
      server.replaceOnBusiness = true
      await authed(new ApiClient(server.url).post('/business')).masquerading('7')
      assert.isTrue(server.active)
      assert.equal(server.currentToken, 'replacement')
      assert.equal(server.stopRequests, 0)
    })
  })

  test('does not retry a stale cleanup token against a replacement mode', async ({ assert }) => {
    await withControlServer(async (server) => {
      server.replaceDuringCleanupStatus = true
      await assert.rejects(
        () => authed(new ApiClient(server.url).post('/business')).masquerading('7'),
        /masquerading\(\) stop control returned 409/
      )
      assert.isTrue(server.active)
      assert.equal(server.currentToken, 'replacement')
      assert.equal(server.stopRequests, 1)
    })
  })
})

type ControlServer = {
  url: string
  active: boolean
  businessToken?: string
  removeOperatorOnBusiness: boolean
  idleStartResponse?: boolean
  activeStopResponse?: boolean
  businessRequests: number
  currentToken: string
  replaceOnBusiness?: boolean
  replaceDuringCleanupStatus?: boolean
  stopRequests: number
  startTargetId?: string
}

function authed<Request extends object>(request: Request): Request {
  return Object.assign(request, { authData: { guard: 'web' } })
}

async function withControlServer(run: (server: ControlServer) => Promise<void>) {
  const state: ControlServer = {
    url: '',
    active: false,
    removeOperatorOnBusiness: false,
    businessRequests: 0,
    currentToken: 'idle',
    stopRequests: 0,
  }
  let removed = false
  const http = createServer((request, response) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    const bodyChunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => bodyChunks.push(chunk))
    request.on('end', () => {
      if (removed) return json(401, { errors: [{ message: 'Unauthorized access' }] })
      if (request.url === '/masquerade' && request.method === 'GET') {
        const statusBody = {
          isMasquerading: state.active,
          contextToken: state.currentToken,
        }
        if (state.active && state.replaceDuringCleanupStatus) {
          state.replaceDuringCleanupStatus = false
          state.currentToken = 'replacement'
        }
        return json(200, statusBody)
      }
      if (request.url === '/masquerade/start') {
        state.startTargetId = JSON.parse(Buffer.concat(bodyChunks).toString()).targetId
        state.active = !state.idleStartResponse
        state.currentToken = 'started'
        return json(200, {
          isMasquerading: state.idleStartResponse ? false : true,
          contextToken: 'started',
        })
      }
      if (request.url === '/masquerade/stop') {
        state.stopRequests++
        if (request.headers['x-masquerade-context'] !== state.currentToken)
          return json(409, { errors: [{ message: 'Stale context' }] })
        state.active = false
        state.currentToken = 'idle'
        return json(200, {
          isMasquerading: state.activeStopResponse ? true : false,
          contextToken: 'idle',
        })
      }
      state.businessRequests++
      state.businessToken = request.headers['x-masquerade-context'] as string | undefined
      if (state.replaceOnBusiness) state.currentToken = 'replacement'
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
