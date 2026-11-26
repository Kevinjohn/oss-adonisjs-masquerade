import type { ModeAccess } from '../types.ts'

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
