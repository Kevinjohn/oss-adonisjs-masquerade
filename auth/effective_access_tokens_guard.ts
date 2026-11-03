import { errors, symbols } from '@adonisjs/auth'
import { RuntimeException } from '@adonisjs/core/exceptions'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import { runtimeFor } from '../src/integration/runtime.js'

/** Effective user facade for a native opaque access-token guard. */
export type EffectiveAccessTokensUser<User> = User extends { currentAccessToken: unknown }
  ? Omit<User, 'currentAccessToken'>
  : User

export class EffectiveAccessTokensGuard<RawUser> implements GuardContract<
  EffectiveAccessTokensUser<RawUser>
> {
  [symbols.GUARD_KNOWN_EVENTS] = undefined
  readonly driverName: string
  user?: EffectiveAccessTokensUser<RawUser>
  isAuthenticated = false
  authenticationAttempted = false
  constructor(
    private ctx: HttpContext,
    private raw: GuardContract<RawUser>,
    private rawName: string
  ) {
    if (raw.driverName !== 'access_tokens')
      throw new TypeError('Masquerade requires a native access_tokens guard')
    this.driverName = raw.driverName
  }
  getUserOrFail(): EffectiveAccessTokensUser<RawUser> {
    if (this.isAuthenticated && this.user !== undefined) return this.user
    if (!this.authenticationAttempted)
      throw new RuntimeException('No effective user is authenticated')
    throw new errors.E_UNAUTHORIZED_ACCESS('Invalid or expired access token', {
      guardDriverName: this.driverName,
    })
  }
  async authenticate(): Promise<EffectiveAccessTokensUser<RawUser>> {
    this.authenticationAttempted = true
    this.isAuthenticated = false
    this.user = undefined
    const runtime = await runtimeFor(this.ctx)
    const selected = runtime.selectGuard(this.ctx)
    if (selected.kind === 'effective') {
      const admitted = await runtime.admit(this.ctx)
      this.user = admitted.effective.user as EffectiveAccessTokensUser<RawUser>
    } else {
      // A public or multi-guard route selects no single credential; this facade still answers
      // only for its own tokens.
      const rawName =
        selected.kind === 'none' || selected.kind === 'ambiguous' ? this.rawName : selected.raw
      this.user = (await (
        this.ctx.auth.use(rawName as never) as GuardContract<RawUser>
      ).authenticate()) as EffectiveAccessTokensUser<RawUser>
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
  authenticateAsClient(user: EffectiveAccessTokensUser<RawUser>, ...args: unknown[]) {
    return this.raw.authenticateAsClient(user as RawUser, ...args)
  }
}
