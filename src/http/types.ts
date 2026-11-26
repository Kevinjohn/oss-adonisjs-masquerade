import type { MiddlewareFn, ParsedNamedMiddleware } from '@adonisjs/core/types/http'
import type { ModeAccess, SubjectId } from '../types.ts'

/** Safe identity fields for a host business audit record; every key is always present. */
export interface MasqueradeAuditFields {
  readonly actorId: SubjectId
  readonly actorIncarnation: string
  readonly effectiveId: SubjectId
  readonly effectiveIncarnation: string
  readonly isMasquerading: boolean
  readonly modeId: string | null
  readonly access: ModeAccess | null
}

/** Options for `masqueradeRoutes`. */
export interface MasqueradeRoutesOptions<Guard extends string> {
  /** The host's named auth middleware, usually `middleware.auth` from `#start/kernel`. */
  auth: (options: { guards: Guard[] }) => MiddlewareFn | ParsedNamedMiddleware
  /** The raw guard that authenticates the operator, such as `web` or `api`. */
  guard: Guard
  /** Limiter for `POST /start`. */
  startLimiter: MiddlewareFn | ParsedNamedMiddleware
  /** Limiter for `POST /stop`, with its own budget. */
  stopLimiter: MiddlewareFn | ParsedNamedMiddleware
  /** Defaults to `/masquerade`. */
  prefix?: string
  /** Route name prefix; defaults to `masquerade`, giving `masquerade.status|start|stop`. */
  as?: string
}
