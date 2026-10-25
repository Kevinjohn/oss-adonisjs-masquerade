import { admission } from '../../src/request_admission.js'
import type { RequestAdmission } from '../../src/request_admission.js'
import type { MasqueradeService } from '../../src/types.js'
import type { RouteGuardSelection } from '../../integration/route_guard_selection.js'
import type { fixture } from './core.js'

type RequestContextOptions = {
  method?: string
  body?: Record<string, unknown>
  raw?: string | null
  hasBody?: boolean
  contentType?: string
  contentLength?: string | null
  header?: string
  route?: unknown
  selectGuard?: (ctx: object) => RouteGuardSelection
  routeMiddleware?: unknown[]
  groupMiddleware?: unknown[]
  defaultGuard?: string
  admit?: (
    request: object,
    fallback: () => Promise<RequestAdmission<unknown>>
  ) => Promise<RequestAdmission<unknown>>
}

export function requestContext(f: ReturnType<typeof fixture>, options: RequestContextOptions) {
  const responseState: {
    status?: number
    json?: unknown
    headers: Map<string, string>
    varies: string[][]
  } = {
    headers: new Map(),
    varies: [],
  }
  const warnings: unknown[] = []
  const routeMiddleware = options.routeMiddleware ?? [
    { name: 'auth', args: [{ guards: ['web_effective'] }] },
  ]
  const groupMiddleware = options.groupMiddleware ?? []
  const ctx: Record<string, any> = {
    actorId: 'a',
    auth: { defaultGuard: options.defaultGuard ?? 'web_effective' },
    route: options.route ?? {
      name: 'business.test',
      pattern: '/business',
      middleware: {
        all: () => new Set([...groupMiddleware, ...routeMiddleware]),
        route: () => new Set(routeMiddleware),
      },
    },
    logger: { warn: (value: unknown) => warnings.push(value) },
    request: {
      method: () => options.method ?? 'POST',
      body: () => options.body ?? {},
      // Adonis BodyParser stores the actual JSON/form wire body on Request.raw().
      raw: () =>
        options.raw !== undefined
          ? options.raw
          : options.body && Object.keys(options.body).length > 0
            ? JSON.stringify(options.body)
            : null,
      hasBody: () =>
        options.hasBody ??
        (options.raw !== null && options.raw !== undefined
          ? options.raw.length > 0
          : Boolean(options.body && Object.keys(options.body).length > 0)),
      header: (name: string) => {
        const normalized = name.toLowerCase()
        if (normalized === 'x-masquerade-context') return options.header
        if (normalized === 'content-type') return options.contentType ?? 'application/json'
        if (normalized === 'content-length') {
          if (options.contentLength === null) return undefined
          return (
            options.contentLength ??
            String(Buffer.byteLength(options.raw ?? JSON.stringify(options.body ?? {})))
          )
        }
        return undefined
      },
    },
    response: {
      header: (name: string, value: string) => responseState.headers.set(name.toLowerCase(), value),
      vary: (value: string[]) => responseState.varies.push(value),
      status: (value: number) => {
        responseState.status = value
        return ctx.response
      },
      json: (value: unknown) => {
        responseState.json = value
      },
    },
    containerResolver: {
      make: async () => ({
        service: await f.create(),
        config: f.config,
        effectiveGuardName: 'web_effective',
        effectiveGuardNames: ['web_effective', 'web_alias'],
        ...(options.selectGuard ? { selectGuard: options.selectGuard } : {}),
        admit: async (request: object) => {
          const service = await f.create()
          const fallback = () =>
            (
              service as MasqueradeService<object> & {
                [admission]: (request: object) => Promise<RequestAdmission<unknown>>
              }
            )[admission](request)
          return options.admit ? options.admit(request, fallback) : fallback()
        },
      }),
    },
  }
  return { ctx: ctx as never, responseState, warnings }
}

/** Give controller tests the same raw-guard selection required of mounted control routes. */
export function controlRequestContext(
  f: ReturnType<typeof fixture>,
  options: RequestContextOptions = {}
) {
  return requestContext(f, {
    ...options,
    routeMiddleware: options.routeMiddleware ?? [{ name: 'auth', args: [{ guards: ['web'] }] }],
    defaultGuard: options.defaultGuard ?? 'web',
    selectGuard: options.selectGuard ?? (() => ({ kind: 'raw', raw: 'web' })),
  })
}
