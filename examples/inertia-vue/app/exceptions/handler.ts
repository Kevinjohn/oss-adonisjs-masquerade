import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'
import { MasqueradeError, type MasqueradeBlockedBy } from '@kevinjohn/adonisjs-masquerade'
import { errors as limiterErrors } from '@adonisjs/limiter'

const blockedActionMessages: Record<MasqueradeBlockedBy, { title: string; message: string }> = {
  sensitive: {
    title: 'Sensitive action blocked',
    message: 'Sensitive account actions are unavailable during support mode.',
  },
  view_only: {
    title: 'Edit blocked in view-only mode',
    message:
      'This support session is view only. Start a new session and choose Can edit to make changes.',
  },
  mutation_not_allowed: {
    title: 'This change is unavailable',
    message: 'The requested change is not allowed in the current support workflow.',
  },
}

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction
  protected renderStatusPages = app.inProduction
  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '404': (_, { inertia }) => inertia.render('errors/not_found', {}),
    '500..599': (_, { inertia }) => inertia.render('errors/server_error', {}),
  }

  async handle(error: unknown, ctx: HttpContext) {
    const status =
      error instanceof MasqueradeError ? error.status : (error as { status?: number })?.status
    if (
      ctx.request.url().startsWith('/support') &&
      [403, 409, 422, 428, 429, 503].includes(status ?? 0)
    ) {
      if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
        for (const [name, value] of Object.entries(error.headers || error.getDefaultHeaders())) {
          ctx.response.header(name, value)
        }
      }
      ctx.response.header('Cache-Control', 'private, no-store')
      const blockedAction =
        error instanceof MasqueradeError && error.code === 'E_MASQUERADE_ACTION_BLOCKED'
          ? blockedActionMessages[error.blockedBy ?? 'sensitive']
          : undefined
      const message =
        blockedAction?.message ??
        (status === 503
          ? 'The previous change may or may not have completed. Check raw status before acting again.'
          : status === 409 || status === 428
            ? 'The support context changed. The old action was rejected. Check status and create a new action.'
            : status === 429
              ? 'Too many attempts. Wait, then check current status.'
              : status === 422
                ? 'Check the customer and reason, then create a new action.'
                : 'This action is unavailable for the current account or support mode.')
      if (ctx.request.header('X-Inertia')) {
        ctx.session.flash(
          'supportRecoveryTitle',
          blockedAction?.title ?? 'Support action needs review'
        )
        ctx.session.flash('supportRecovery', message)
        return ctx.inertia.location('/support/recovery')
      }
      if (ctx.request.header('accept')?.includes('text/html')) {
        ctx.session.flash(
          'supportRecoveryTitle',
          blockedAction?.title ?? 'Support action needs review'
        )
        ctx.session.flash('supportRecovery', message)
        return ctx.response.redirect().toPath('/support/recovery')
      }
    }
    return super.handle(error, ctx)
  }
}
