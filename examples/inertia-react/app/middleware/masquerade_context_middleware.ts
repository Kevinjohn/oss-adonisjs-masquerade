import { masqueradeContext } from '@kevinjohn/adonisjs-masquerade/http'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class MasqueradeContextMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    return masqueradeContext(ctx, next)
  }
}
