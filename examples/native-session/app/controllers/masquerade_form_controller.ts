import type { HttpContext } from '@adonisjs/core/http'
import { MasqueradeError } from 'adonisjs-masquerade'
import type { StartInput, StopInput, MasqueradeErrorCode } from 'adonisjs-masquerade'
import { MasqueradeController } from 'adonisjs-masquerade/http'
import type { MasqueradeRuntime } from 'adonisjs-masquerade/providers/masquerade_provider'

type FormAction = 'start' | 'stop'
export type MasqueradeFormFlash =
  | { type: 'success'; action: 'started' | 'stopped' }
  | {
      type: 'error'
      code: MasqueradeErrorCode
    }

/** Host-owned HTML form adapter. This is the generated --form-controller starter. */
export default class MasqueradeFormController extends MasqueradeController {
  protected redirectAfterStart(_ctx: HttpContext): string {
    return '/'
  }

  protected redirectAfterStop(_ctx: HttpContext): string {
    return '/'
  }

  override async start(ctx: HttpContext): Promise<void> {
    if (!acceptsHtmlForm(ctx)) return super.start(ctx)
    await this.transition(ctx, 'start')
  }

  override async stop(ctx: HttpContext): Promise<void> {
    if (!acceptsHtmlForm(ctx)) return super.stop(ctx)
    await this.transition(ctx, 'stop')
  }

  private async transition(ctx: HttpContext, action: FormAction): Promise<void> {
    noStore(ctx)
    try {
      const runtime = (await ctx.containerResolver.make('masquerade.runtime')) as MasqueradeRuntime
      if (action === 'start') await runtime.service.start(ctx, parseStartForm(ctx))
      else await runtime.service.stop(ctx, parseStopForm(ctx))

      flash(ctx, { type: 'success', action: action === 'start' ? 'started' : 'stopped' })
      ctx.response.redirect().toPath(this.successPath(ctx, action))
    } catch (error) {
      if (!(error instanceof MasqueradeError)) throw error
      flash(ctx, { type: 'error', code: error.code })
      ctx.response.redirect().toPath(this.errorPath(ctx, action))
    }
  }

  protected successPath(ctx: HttpContext, action: FormAction): string {
    return action === 'start' ? this.redirectAfterStart(ctx) : this.redirectAfterStop(ctx)
  }

  protected errorPath(_ctx: HttpContext, _action: FormAction): string {
    return '/'
  }
}

const bodyLimit = 8 * 1024
const startKeys = new Set([
  'targetId',
  'reason',
  'durationSeconds',
  'access',
  '_masqueradeContext',
  '_csrf',
])
const stopKeys = new Set(['_masqueradeContext', '_csrf'])

function parseStartForm(ctx: HttpContext): StartInput {
  const body = formBody(ctx, startKeys)
  if (!body) return { __invalidHttpInput: true } as unknown as StartInput
  return {
    targetId: body.targetId as StartInput['targetId'],
    reason: body.reason as StartInput['reason'],
    ...(body.access === undefined ? {} : { access: body.access as StartInput['access'] }),
    ...(body.durationSeconds === undefined
      ? {}
      : { durationSeconds: formDuration(body.durationSeconds) }),
    expectedContext: controlToken(ctx, body) ?? '',
  }
}

function parseStopForm(ctx: HttpContext): StopInput {
  const body = formBody(ctx, stopKeys)
  if (!body) return { __invalidHttpInput: true } as unknown as StopInput
  return { expectedContext: controlToken(ctx, body) ?? '' }
}

function acceptsHtmlForm(ctx: HttpContext): boolean {
  const accept = ctx.request.header('accept')
  const explicitlyAcceptsHtml = accept?.split(',').some((entry) => {
    const mediaType = entry.split(';', 1)[0]?.trim().toLowerCase()
    return mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
  })
  return Boolean(explicitlyAcceptsHtml && ctx.request.accepts(['html', 'json']) === 'html')
}

function formBody(ctx: HttpContext, allowedKeys: Set<string>): Record<string, unknown> | null {
  const contentType = ctx.request.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  const contentLength = ctx.request.header('content-length')
  const raw = ctx.request.raw()
  const body = ctx.request.body()
  if (contentType !== 'application/x-www-form-urlencoded') return null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return null
  if (raw !== null) return Buffer.byteLength(raw, 'utf8') <= bodyLimit ? body : null

  const empty = Object.keys(body).length === 0
  const zeroLength = contentLength === '0' && ctx.request.header('transfer-encoding') === undefined
  const unframedEmpty = !ctx.request.hasBody() && contentLength === undefined
  if (!empty || (!zeroLength && !unframedEmpty)) return null
  return body
}

function formDuration(value: unknown): StartInput['durationSeconds'] {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))
    return value as unknown as StartInput['durationSeconds']
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : (value as unknown as StartInput['durationSeconds'])
}

function controlToken(ctx: HttpContext, body: Record<string, unknown>): string | undefined {
  const header = ctx.request.header('X-Masquerade-Context')
  const hidden = body._masqueradeContext
  if (header !== undefined && hidden !== undefined && header !== hidden)
    return `0.${'0'.repeat(32)}`
  const token = header ?? hidden
  return typeof token === 'string' ? token : undefined
}

function noStore(ctx: HttpContext): void {
  ctx.response.header('Cache-Control', 'private, no-store')
  ctx.response.vary(['Accept', 'X-Masquerade-Context'])
}

function flash(ctx: HttpContext, message: MasqueradeFormFlash): void {
  ctx.session.flash({ masquerade: message })
}
