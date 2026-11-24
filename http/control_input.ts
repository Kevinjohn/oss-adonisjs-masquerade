import type { HttpContext } from '@adonisjs/core/http'

const BODY_LIMIT = 8 * 1024

/** A valid-shape token that can never match: idle tokens have 64 hex characters, rows have revision >= 1. */
const rejectedContextToken = `0.${'0'.repeat(32)}`

/** Options for the control input parsers. */
type ControlInputOptions = {
  /** Accept only an `application/x-www-form-urlencoded` body. */
  formOnly?: boolean
}

/**
 * Parse start control input, or return the malformed-input marker so the service records its
 * normal denied-outcome audit for an invalid shape.
 */
export function parseStartControlOrInvalidMarker(
  ctx: HttpContext,
  { formOnly = false }: ControlInputOptions = {}
): Record<string, unknown> {
  const body = readControlBody(ctx)
  if (!body || (formOnly && !isForm(ctx)) || !isWithinBodyLimit(ctx))
    return buildInvalidInputMarker()
  if (
    Object.keys(body).some(
      (key) =>
        ![
          'targetId',
          'reason',
          'durationSeconds',
          'access',
          '_masqueradeContext',
          '_csrf',
        ].includes(key)
    )
  )
    return buildInvalidInputMarker()
  const expectedContext = resolveControlToken(ctx, body)
  const durationSeconds = coerceFormDuration(ctx, body.durationSeconds)
  // The body parser turns blank form fields into null; a blank optional field takes its default.
  // JSON null stays explicit input, which core validation rejects.
  const isAbsentControlValue = (value: unknown) =>
    value === undefined || (value === null && isForm(ctx))
  return {
    targetId: body.targetId,
    reason: body.reason,
    ...(isAbsentControlValue(body.access) ? {} : { access: body.access }),
    ...(isAbsentControlValue(body.durationSeconds) ? {} : { durationSeconds }),
    expectedContext: expectedContext ?? '',
  }
}

/** Parse stop control input, or return the malformed-input marker for an invalid shape. */
export function parseStopControlOrInvalidMarker(
  ctx: HttpContext,
  { formOnly = false }: ControlInputOptions = {}
): Record<string, unknown> {
  const body = readControlBody(ctx)
  if (!body || (formOnly && !isForm(ctx)) || !isWithinBodyLimit(ctx))
    return buildInvalidInputMarker()
  if (Object.keys(body).some((key) => !['_masqueradeContext', '_csrf'].includes(key)))
    return buildInvalidInputMarker()
  return { expectedContext: resolveControlToken(ctx, body) ?? '' }
}

function isWithinBodyLimit(ctx: HttpContext): boolean {
  const raw = ctx.request.raw()
  const contentLength = ctx.request.header('content-length')
  const contentType = ctx.request.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  const supportedType =
    contentType === 'application/json' || contentType === 'application/x-www-form-urlencoded'
  if (contentType === 'multipart/form-data') return false
  if (raw !== null) return supportedType && Buffer.byteLength(raw, 'utf8') <= BODY_LIMIT

  const body = ctx.request.body()
  const empty = body && typeof body === 'object' && Object.keys(body).length === 0
  // Native hasBody() also returns true with Content-Length: 0. Explicit zero framing is empty;
  // chunked/unknown framing must never turn an unparsed payload into an accepted empty stop.
  const zeroLength = contentLength === '0' && ctx.request.header('transfer-encoding') === undefined
  return Boolean(empty && (zeroLength || (!ctx.request.hasBody() && contentLength === undefined)))
}

function isForm(ctx: HttpContext): boolean {
  const contentType = ctx.request.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return contentType === 'application/x-www-form-urlencoded'
}

/** Form parsers expose numbers as strings; accept only canonical safe integer strings. */
function coerceFormDuration(ctx: HttpContext, value: unknown): unknown {
  if (!isForm(ctx) || typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))
    // Preserve noncanonical and JSON values so core runtime validation rejects them unchanged.
    return value
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : value
}

function readControlBody(ctx: HttpContext): Record<string, unknown> | null {
  const body = ctx.request.body()
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
}

function resolveControlToken(ctx: HttpContext, body: Record<string, unknown>): string | undefined {
  const header = ctx.request.header('X-Masquerade-Context')
  const hidden = body._masqueradeContext
  if (header !== undefined && hidden !== undefined && header !== hidden) return rejectedContextToken
  const token = header ?? hidden
  return typeof token === 'string' ? token : undefined
}

/** Deliberately malformed core input makes the service write its normal denied-outcome audit. */
function buildInvalidInputMarker(): Record<string, unknown> {
  return { __invalidHttpInput: true }
}
