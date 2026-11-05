import { ApiClient, ApiRequest } from '@japa/api-client'
import { InvalidArgumentsException, RuntimeException } from '@adonisjs/core/exceptions'
import type { ApiResponse } from '@japa/api-client'
import type { PluginFn } from '@japa/runner/types'
import type { ModeAccess } from '../src/types.js'

const CONTEXT_HEADER = 'X-Masquerade-Context'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Start options for `request.masquerading(target, options)`. */
export interface MasqueradingOptions {
  /** Defaults to `view`. */
  access?: ModeAccess
  reason?: string
  durationSeconds?: number
  /** Control route prefix; defaults to the plugin's `prefix`. */
  prefix?: string
}

/** Options for the `masqueradeApiClient` plugin. */
export interface MasqueradeApiClientOptions {
  /** Control route prefix mounted by the host; defaults to `/masquerade`. */
  prefix?: string
}

/** The target account: a model with an `id`, or the ID itself. */
export type MasqueradeTarget = { id: string | number | bigint } | string | number | bigint

interface MasqueradingData {
  targetId: string
  options: MasqueradingOptions
}

declare module '@japa/api-client' {
  interface ApiRequest {
    masqueradingData?: MasqueradingData
    /**
     * Start a real mode for the `loginAs` actor through the host's control routes before this
     * request, send the current context token on unsafe methods, and stop the mode afterwards.
     */
    masquerading(target: MasqueradeTarget, options?: MasqueradingOptions): this
  }
}

/** Japa API client plugin adding `request.masquerading(target, options)`. */
export function masqueradeApiClient(pluginOptions: MasqueradeApiClientOptions = {}): PluginFn {
  return function () {
    ApiRequest.macro(
      'masquerading',
      function (this: ApiRequest, target: MasqueradeTarget, options: MasqueradingOptions = {}) {
        this.masqueradingData = { targetId: targetId(target), options }
        return this
      }
    )

    ApiClient.setup(async (request) => {
      const data = request.masqueradingData
      if (!data) return
      const authData = (request as { authData?: unknown }).authData
      if (!authData)
        throw new InvalidArgumentsException('masquerading() requires loginAs() on the same request')
      const prefix = data.options.prefix ?? pluginOptions.prefix ?? '/masquerade'
      const control = (method: 'GET' | 'POST', path: string) => {
        const nested = new ApiClient(request.config.baseUrl).request(`${prefix}${path}`, method)
        Object.assign(nested, { authData })
        nested.header('Accept', 'application/json')
        const csrf = (nested as { withCsrfToken?: () => unknown }).withCsrfToken
        if (method === 'POST' && typeof csrf === 'function') csrf.call(nested)
        return nested
      }

      const idle = await expectMode(await control('GET', ''), 'status')
      const { access, reason, durationSeconds } = data.options
      const started = await expectMode(
        await control('POST', '/start')
          .header(CONTEXT_HEADER, idle.contextToken)
          .json({
            targetId: data.targetId,
            ...(access === undefined ? {} : { access }),
            ...(reason === undefined ? {} : { reason }),
            ...(durationSeconds === undefined ? {} : { durationSeconds }),
          }),
        'start'
      )
      // A token the test set itself is what it means to send, such as a stale one.
      const explicit = (request.request as { get(field: string): unknown }).get(CONTEXT_HEADER)
      if (!SAFE_METHODS.has(request.config.method.toUpperCase()) && explicit === undefined)
        request.header(CONTEXT_HEADER, started.contextToken)

      return async () => {
        const status = await control('GET', '')
        // The request deleted or deactivated the operator, so their mode cannot be stopped over
        // HTTP; Masquerade invalidates it at that account's next admission.
        if (status.status() === 401) return
        const current = await expectMode(status, 'status')
        if (!current.isMasquerading) return
        await expectMode(
          await control('POST', '/stop').header(CONTEXT_HEADER, current.contextToken).json({}),
          'stop'
        )
      }
    })
  }
}

function targetId(target: MasqueradeTarget): string {
  const id = typeof target === 'object' && target !== null ? target.id : target
  if (!['string', 'number', 'bigint'].includes(typeof id) || String(id) === '')
    throw new InvalidArgumentsException('masquerading() requires a target with an id')
  return String(id)
}

async function expectMode(
  response: ApiResponse,
  control: string
): Promise<{ isMasquerading: boolean; contextToken: string }> {
  const body = response.body() as { isMasquerading?: unknown; contextToken?: unknown } | undefined
  if (
    response.status() !== 200 ||
    typeof body?.isMasquerading !== 'boolean' ||
    typeof body.contextToken !== 'string'
  )
    throw new RuntimeException(
      `masquerading() ${control} control returned ${response.status()}: ${JSON.stringify(body)}`
    )
  return { isMasquerading: body.isMasquerading, contextToken: body.contextToken }
}
