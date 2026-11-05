import type { HttpContext } from '@adonisjs/core/http'
import type { StartInput } from '../src/types.js'

const BODY_LIMIT = 8 * 1024

/** Parse start control input while leaving invalid-shape handling to the service audit boundary. */
export function parseStartControl(ctx: HttpContext): StartInput {
  const body = readControlBody(ctx)
  if (!body || !isWithinBodyLimit(ctx)) return invalidStartInput()
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
    return invalidStartInput()
  const expectedContext = controlToken(ctx, body)
  const durationSeconds = formDuration(ctx, body.durationSeconds)
  return {
    targetId: body.targetId as unknown as StartInput['targetId'],
    reason: body.reason as unknown as StartInput['reason'],
    ...(body.access === undefined
      ? {}
      : { access: body.access as unknown as StartInput['access'] }),
    ...(body.durationSeconds === undefined ? {} : { durationSeconds }),
    expectedContext: expectedContext ?? '',
  }
}

/** Parse stop control input while leaving invalid-shape handling to the service audit boundary. */
export function parseStopControl(ctx: HttpContext): { expectedContext: string } {
  const body = readControlBody(ctx)
  if (!body || !isWithinBodyLimit(ctx)) return invalidStopInput()
  if (Object.keys(body).some((key) => !['_masqueradeContext', '_csrf'].includes(key)))
    return invalidStopInput()
  return { expectedContext: controlToken(ctx, body) ?? '' }
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

/** Form parsers expose numbers as strings; accept only canonical safe integer strings. */
function formDuration(ctx: HttpContext, value: unknown): StartInput['durationSeconds'] {
  const contentType = ctx.request.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (
    contentType !== 'application/x-www-form-urlencoded' ||
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  )
    // Preserve noncanonical and JSON values so core runtime validation rejects them unchanged.
    return value as unknown as StartInput['durationSeconds']
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : (value as unknown as StartInput['durationSeconds'])
}

function readControlBody(ctx: HttpContext): Record<string, unknown> | null {
  const body = ctx.request.body()
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
}

function controlToken(ctx: HttpContext, body: Record<string, unknown>): string | undefined {
  const header = ctx.request.header('X-Masquerade-Context')
  const hidden = body._masqueradeContext
  if (header !== undefined && hidden !== undefined && header !== hidden)
    return rejectedContextToken()
  const token = header ?? hidden
  return typeof token === 'string' ? token : undefined
}

/** A valid-shape token that can never match: idle tokens have 64 hex characters, rows have revision >= 1. */
function rejectedContextToken(): string {
  return `0.${'0'.repeat(32)}`
}

/** Deliberately malformed core input makes the service write its normal denied-outcome audit. */
function invalidStartInput(): StartInput {
  return { __invalidHttpInput: true } as unknown as StartInput
}

/** Deliberately malformed core input makes the service write its normal denied-outcome audit. */
function invalidStopInput(): { expectedContext: string } {
  return { __invalidHttpInput: true } as unknown as { expectedContext: string }
}
