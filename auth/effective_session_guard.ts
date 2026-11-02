import { errors, symbols } from '@adonisjs/auth'
import { RuntimeException } from '@adonisjs/core/exceptions'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type {} from '@adonisjs/auth/initialize_auth_middleware'
import { runtimeFor } from '../integration/runtime.js'

/**
 * A native session wrapper; the raw guard continues to own all credentials.
 * @internal
 */
export class EffectiveSessionGuard<User> implements GuardContract<User> {
  [symbols.GUARD_KNOWN_EVENTS] = undefined
  readonly driverName: string
  user?: User
  isAuthenticated = false
  authenticationAttempted = false
  constructor(
    private rawName: string,
    private ctx: HttpContext,
    private raw: GuardContract<User>
  ) {
    if (raw.driverName !== 'session')
      throw new TypeError('Masquerade requires a native session guard')
    this.driverName = raw.driverName
  }
  getUserOrFail(): User {
    if (!this.isAuthenticated || this.user === undefined) {
      if (this.authenticationAttempted) {
        throw new errors.E_UNAUTHORIZED_ACCESS('Invalid or expired user session', {
          guardDriverName: this.driverName,
        })
      }
      throw new RuntimeException('No effective user is authenticated')
    }
    return this.user
  }
  async authenticate(): Promise<User> {
    this.authenticationAttempted = true
    this.isAuthenticated = false
    this.user = undefined
    const runtime = await runtimeFor(this.ctx)
    const selected = runtime.selectGuard(this.ctx)
    if (selected.kind === 'effective') {
      const admitted = await runtime.admit(this.ctx)
      this.user = admitted.effective.user as User
    } else {
      const raw = this.ctx.auth.use(
        (selected.kind === 'ambiguous' ? this.rawName : selected.raw) as never
      ) as GuardContract<User>
      this.user = await raw.authenticate()
    }
    this.isAuthenticated = true
    return this.user
  }
  async check(): Promise<boolean> {
    try {
      await this.authenticate()
      return true
    } catch (error) {
      if (error instanceof errors.E_UNAUTHORIZED_ACCESS) return false
      throw error
    }
  }
  authenticateAsClient(user: User, ...args: unknown[]) {
    return this.raw.authenticateAsClient(user, ...args)
  }
}
