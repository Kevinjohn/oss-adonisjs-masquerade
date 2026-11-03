import { masqueradeContext } from '@kevinjohn/adonisjs-masquerade/http'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

const warnings: unknown[] = []

export function takeMasqueradeWarnings(): unknown[] {
  return warnings.splice(0)
}

export default class MasqueradeContextMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const logger = ctx.logger
    const originalWarn = logger.warn.bind(logger)
    logger.warn = (...args: Parameters<typeof logger.warn>) => {
      warnings.push(args[0])
      return originalWarn(...args)
    }
    try {
      return await masqueradeContext(ctx, next)
    } finally {
      logger.warn = originalWarn
    }
  }
}
