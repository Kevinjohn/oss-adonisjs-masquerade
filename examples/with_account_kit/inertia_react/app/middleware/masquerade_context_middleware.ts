import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { masqueradeContext } from '@kevinjohn/adonisjs-masquerade/http'

export default class MasqueradeContextMiddleware {
  handle(ctx: HttpContext, next: NextFn) {
    return masqueradeContext(ctx, next)
  }
}