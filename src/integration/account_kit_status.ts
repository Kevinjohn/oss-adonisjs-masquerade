import type { ApplicationService } from '@adonisjs/core/types'

class AccountKitBlockerStatus {
  #verified = new WeakSet<ApplicationService>()

  /** Set only after the committed router and installed blocker have been checked. */
  recordAccountKitBlocker(app: ApplicationService): void {
    this.#verified.add(app)
  }

  hasVerifiedAccountKitBlocker(app: ApplicationService): boolean {
    return this.#verified.has(app)
  }
}

export const accountKitBlockerStatus = new AccountKitBlockerStatus()
