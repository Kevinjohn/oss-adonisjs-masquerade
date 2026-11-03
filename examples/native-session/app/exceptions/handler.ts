import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade'
import { errors as limiterErrors } from '@adonisjs/limiter'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * Status pages are used to display a custom HTML pages for certain error
   * codes. You might want to enable them in production only, but feel
   * free to enable them in development as well.
   */
  protected renderStatusPages = app.inProduction

  /**
   * Status pages is a collection of error code range and a callback
   * to return the HTML contents to send as a response.
   */
  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '404': (error, { view }) => {
      return view.render('pages/errors/not_found', { error })
    },
    '500..599': (error, { view }) => {
      return view.render('pages/errors/server_error', { error })
    },
  }

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    const path = ctx.request.url()
    const acceptsHtml = ctx.request.accepts(['html', 'json']) === 'html'
    const supportPath = path === '/dashboard' || path === '/support' || path.startsWith('/support/')
    const status =
      error instanceof MasqueradeError ? error.status : (error as { status?: number })?.status
    if (acceptsHtml && supportPath && [403, 409, 422, 428, 429, 503].includes(status ?? 0)) {
      if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
        const headers = error.headers || error.getDefaultHeaders()
        for (const [name, value] of Object.entries(headers)) ctx.response.header(name, value)
      }
      const details = supportErrorDetails(status!, error)
      ctx.response.header('Cache-Control', 'private, no-store')
      ctx.response.vary(['Accept', 'X-Masquerade-Context'])
      ctx.response.status(status!)
      return ctx.response.send(await ctx.view.render('pages/errors/support_recovery', details))
    }
    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}

function supportErrorDetails(status: number, error: unknown) {
  const code = error instanceof MasqueradeError ? error.code : undefined
  if (status === 503) {
    return {
      title: 'Support status is unavailable',
      explanation:
        'The last change may or may not have completed. Check current status before deciding what to do next. Do not resubmit the old form.',
    }
  }
  if (status === 429) {
    return {
      title: 'Too many control attempts',
      explanation:
        'Wait before trying another control change. Check current status first; if a mode is active, its stop control remains on the operator page.',
    }
  }
  if (status === 409 || status === 428) {
    return {
      title: 'Support context changed',
      explanation:
        'Another tab or session may have changed the mode, or its deadline passed. Check status and rebuild the action from the current customer page. The old action was not replayed.',
    }
  }
  if (code === 'E_MASQUERADE_ACTION_BLOCKED') {
    const blockedBy = (error as MasqueradeError).blockedBy
    if (blockedBy === 'view_only') {
      return {
        title: 'View-only support mode',
        explanation:
          'This mode can read customer information but cannot change it. Stop support mode and start a new one with edit access when the host allows it.',
      }
    }
    if (blockedBy === 'mutation_not_allowed') {
      return {
        title: 'This action is unavailable in support mode',
        explanation:
          'Edit access is active, but this action is not available during support mode. The customer preference can still be changed when the customer permits it.',
      }
    }
    return {
      title: 'Sensitive action blocked',
      explanation:
        'This action is unavailable while support mode is active. The customer preference can still be changed when the customer permits it.',
    }
  }
  if (status === 422) {
    return {
      title: 'Check the support form',
      explanation:
        'The customer or reason was not valid. Check current status, then choose an eligible customer and enter a reason.',
    }
  }
  return {
    title: 'Access was denied',
    explanation:
      'The account or current customer cannot use this action. Check support status or stop the mode from the operator workspace.',
  }
}
