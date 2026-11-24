import type { HttpContext } from '@adonisjs/core/http'
import type { MasqueradeResponseCode } from '@kevinjohn/adonisjs-masquerade'
import { isMasqueradeRequestError, MasqueradeController } from '@kevinjohn/adonisjs-masquerade/http'

type FormAction = 'start' | 'stop'
export type MasqueradeFormFlash =
  | { type: 'success'; action: 'started' | 'stopped' }
  | {
      type: 'error'
      code: MasqueradeResponseCode
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
      // Like the package controller, control only from a route on the operator's raw guard.
      await this.formTransition(ctx, action)

      flash(ctx, { type: 'success', action: action === 'start' ? 'started' : 'stopped' })
      ctx.response.redirect().toPath(this.successPath(ctx, action))
    } catch (error) {
      if (!isMasqueradeRequestError(error)) throw error
      flash(ctx, { type: 'error', code: error.responseCode })
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

function acceptsHtmlForm(ctx: HttpContext): boolean {
  const accept = ctx.request.header('accept')
  const explicitlyAcceptsHtml = accept?.split(',').some((entry) => {
    const mediaType = entry.split(';', 1)[0]?.trim().toLowerCase()
    return mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
  })
  return Boolean(explicitlyAcceptsHtml && ctx.request.accepts(['html', 'json']) === 'html')
}

function noStore(ctx: HttpContext): void {
  ctx.response.header('Cache-Control', 'private, no-store')
  ctx.response.vary(['Accept', 'X-Masquerade-Context'])
}

function flash(ctx: HttpContext, message: MasqueradeFormFlash): void {
  ctx.session.flash({ masquerade: message })
}
