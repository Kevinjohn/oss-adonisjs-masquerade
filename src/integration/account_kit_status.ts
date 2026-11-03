import type { ApplicationService } from '@adonisjs/core/types'

const verified = new WeakSet<ApplicationService>()

/** Set only after the committed router and installed blocker have been checked. */
export function recordAccountKitBlocker(app: ApplicationService): void {
  verified.add(app)
}

export function hasVerifiedAccountKitBlocker(app: ApplicationService): boolean {
  return verified.has(app)
}
