import { E_UNAUTHORIZED_ACCESS } from '../errors.ts'
import { errors, symbols } from '@adonisjs/auth'
import { InvalidArgumentsException, RuntimeException } from '@adonisjs/core/exceptions'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type {} from '@adonisjs/auth/initialize_auth_middleware'
import { resolveRuntime } from '../integration/runtime.ts'
import { contextEnforcement } from '../integration/context_enforcement.ts'
import type { ResolvedContext } from '../types.ts'

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
  #context: ResolvedContext | undefined
  /** The view-as context admitted by `authenticate()` when the route selected this effective guard; otherwise undefined. */
  get context(): ResolvedContext | undefined {
    return this.#context
  }
  #ctx: HttpContext
  #raw: GuardContract<User>
  #rawName: string
  constructor(rawName: string, ctx: HttpContext, raw: GuardContract<User>) {
    this.#ctx = ctx
    this.#raw = raw
    this.#rawName = rawName
    if (raw.driverName !== 'session')
      throw new InvalidArgumentsException('Masquerade requires a native session guard')
    this.driverName = raw.driverName
  }
  /**
   * Get the effective user after the route authenticates.
   *
   * @example
   * ```ts
   * const customer = guard.getUserOrFail()
   * ```
   */
  getUserOrFail(): User {
    if (!this.isAuthenticated || this.user === undefined) {
      if (this.authenticationAttempted) {
        throw new E_UNAUTHORIZED_ACCESS('Invalid or expired user session', {
          guardDriverName: this.driverName,
        })
      }
      throw new RuntimeException('No effective user is authenticated')
    }
    return this.user
  }
  /**
   * Authenticate the raw credential and resolve the effective user for this route.
   *
   * @example
   * ```ts
   * const customer = await guard.authenticate()
   * ```
   */
  async authenticate(): Promise<User> {
    this.authenticationAttempted = true
    this.isAuthenticated = false
    this.#context = undefined
    this.user = undefined
    const runtime = await resolveRuntime(this.#ctx)
    const selected = runtime.selectGuard(this.#ctx)
    if (selected.kind === 'effective') {
      const admitted = await runtime.admit(this.#ctx)
      contextEnforcement.assertContextEnforced(this.#ctx, {
        isMasquerading: admitted.context.isMasquerading,
      })
      // Admission is memoized per request; a raw logout later in the request ends it, as natively.
      const raw = this.#ctx.auth.use(selected.raw as never) as GuardContract<User>
      if (!raw.isAuthenticated)
        throw new E_UNAUTHORIZED_ACCESS('Invalid or expired user session', {
          guardDriverName: this.driverName,
        })
      this.user = admitted.effective.user as User
      this.#context = admitted.context
    } else {
      const raw = this.#ctx.auth.use(
        (selected.kind === 'ambiguous' ? this.#rawName : selected.raw) as never
      ) as GuardContract<User>
      this.user = await raw.authenticate()
    }
    this.isAuthenticated = true
    return this.user
  }
  /**
   * Check whether the request authenticates; operational failures reject.
   *
   * @example
   * ```ts
   * const signedIn = await guard.check()
   * ```
   */
  async check(): Promise<boolean> {
    try {
      await this.authenticate()
      return true
    } catch (error) {
      if (error instanceof errors.E_UNAUTHORIZED_ACCESS) return false
      throw error
    }
  }
  /**
   * Delegate test-client authentication to the native guard.
   *
   * @example
   * ```ts
   * const credential = await guard.authenticateAsClient(operator)
   * ```
   */
  authenticateAsClient(user: User, ...args: unknown[]) {
    return this.#raw.authenticateAsClient(user, ...args)
  }
}
