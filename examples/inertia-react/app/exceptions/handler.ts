import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'
import { MasqueradeError, type MasqueradeBlockedBy } from '@kevinjohn/adonisjs-masquerade'
import { errors as limiterErrors } from '@adonisjs/limiter'

const blockedActionPresentations: Record<MasqueradeBlockedBy, { title: string; message: string }> =
  {
    sensitive: {
      title: 'Sensitive action is unavailable',
      message: 'Sensitive account actions must use the account’s protected workflow.',
    },
    view_only: {
      title: 'View-only support mode blocked this change',
      message:
        'This support mode can read customer information but cannot change it. Stop support mode and start again with Can edit only when the host allows it.',
    },
    mutation_not_allowed: {
      title: 'This action is not available in support mode',
      message: 'Use the account’s normal workflow to make this change.',
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
    const path = ctx.request.url()
    const status =
      error instanceof MasqueradeError ? error.status : (error as { status?: number })?.status
    if (path.startsWith('/support') && [403, 409, 422, 428, 429, 503].includes(status ?? 0)) {
      if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
        for (const [name, value] of Object.entries(error.headers || error.getDefaultHeaders()))
          ctx.response.header(name, value)
      }
      ctx.response.header('Cache-Control', 'private, no-store')
      let title = 'Support action needs review'
      let message =
        status === 503
          ? 'The previous change may or may not have completed. Check raw status before acting again.'
          : status === 409 || status === 428
            ? 'The support context changed. The old action was rejected. Check status and create a new action.'
            : status === 429
              ? 'Too many attempts. Wait, then check current status.'
              : status === 422
                ? 'Check the customer and reason, then create a new action.'
                : 'This action is unavailable for the current account or support mode.'
      if (error instanceof MasqueradeError && error.code === 'E_MASQUERADE_ACTION_BLOCKED') {
        const presentation =
          blockedActionPresentations[error.blockedBy ?? 'sensitive'] ??
          blockedActionPresentations.sensitive
        title = presentation.title
        message = presentation.message
      }
      if (ctx.request.header('X-Inertia')) {
        ctx.session.flash('supportRecoveryTitle', title)
        ctx.session.flash('supportRecovery', message)
        return ctx.inertia.location('/support/recovery')
      }
      if (ctx.request.header('accept')?.includes('text/html')) {
        ctx.session.flash('supportRecoveryTitle', title)
        ctx.session.flash('supportRecovery', message)
        return ctx.response.redirect().toPath('/support/recovery')
      }
      return super.handle(error, ctx)
    }
    return super.handle(error, ctx)
  }
}
