import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import type User from '#models/user'

export default class InertiaMiddleware extends BaseInertiaMiddleware {
  share(ctx: HttpContext) {
    const { auth } = ctx as Partial<HttpContext>
    const user = auth?.use('web').user as User | undefined
    return {
      errors: ctx.inertia.always(this.getValidationErrors(ctx)),
      user: ctx.inertia.always(user ? { fullName: user.fullName, email: user.email } : undefined),
    }
  }

  /**
   * Flash messages travel in the page object's `flash` field, which the
   * client strips from history state, so Back does not show them again.
   */
  flash(ctx: HttpContext) {
    const { session } = ctx as Partial<HttpContext>
    const success: string | undefined = session?.flashMessages.get('success')
    const error: string | undefined = session?.flashMessages.get('error')
    return { success, error }
  }
  async handle(ctx: HttpContext, next: NextFn) {
    await this.init(ctx)
    const output = await next()
    this.dispose(ctx)
    return output
  }
}

declare module '@adonisjs/inertia/types' {
  type MiddlewareSharedProps = InferSharedProps<InertiaMiddleware>
  export interface SharedProps extends MiddlewareSharedProps {}
}
