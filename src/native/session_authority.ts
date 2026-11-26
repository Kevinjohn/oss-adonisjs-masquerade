import type { SessionAuthorityOptions, NativeSessionAdapter } from '../types.ts'
import { E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import { errors } from '@adonisjs/auth'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type {} from '@adonisjs/auth/initialize_auth_middleware'
import type { GuardContract } from '@adonisjs/auth/types'
import { AccountAuthority, buildSubject } from './account_authority.ts'

/**
 * Use the same public user provider as the raw native session guard.
 *
 * @example
 * ```ts
 * import { sessionAuthority, stampFrom } from '@kevinjohn/adonisjs-masquerade/native'
 *
 * type Account = { id: string; active: boolean; securityRevision: number }
 * export function webAuthority(provider: SessionUserProviderContract<Account>) {
 *   return sessionAuthority({
 *     namespace: 'users',
 *     guard: 'web',
 *     provider,
 *     incarnation: 'id',
 *     securityStamp: stampFrom((user: Account) => [user.securityRevision]),
 *     isActive: (user) => user.active,
 *   })
 * }
 * ```
 */
export function sessionAuthority<User>(
  options: SessionAuthorityOptions<User>
): NativeSessionAdapter<User> {
  if (
    !options ||
    typeof options.provider?.createUserForGuard !== 'function' ||
    typeof options.provider.findById !== 'function' ||
    typeof options.isActive !== 'function' ||
    typeof options.securityStamp !== 'function' ||
    !(options.incarnation === 'id' || typeof options.incarnation === 'function')
  )
    throw new InvalidArgumentsException('Invalid native session authority')
  const { namespace, guard, provider } = options
  const incarnation = options.incarnation === 'id' ? 'id' : options.incarnation.bind(options)
  const securityStamp = options.securityStamp.bind(options)
  const isActive = options.isActive.bind(options)
  const authority = new AccountAuthority({
    namespace,
    guard,
    provider,
    incarnation,
    securityStamp,
    isActive,
  })
  return new SessionAdapter(guard, provider, authority)
}

class SessionAdapter<User> implements NativeSessionAdapter<User> {
  declare readonly authority: AccountAuthority<User>
  declare readonly driverName: 'session'
  declare readonly authenticateActor: NativeSessionAdapter<User>['authenticateActor']
  #guard: string
  #provider: SessionAuthorityOptions<User>['provider']

  constructor(
    guard: string,
    provider: SessionAuthorityOptions<User>['provider'],
    authority: AccountAuthority<User>
  ) {
    this.#guard = guard
    this.#provider = provider
    this.authority = authority
    this.driverName = 'session'
    this.authenticateActor = this.#authenticateActor.bind(this)
    Object.freeze(this)
  }

  async #authenticateActor(ctx: HttpContext) {
    let raw: GuardContract<User>
    try {
      raw = ctx.auth.use(this.#guard as never) as GuardContract<User>
    } catch (error) {
      if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
      throw new E_MASQUERADE_UNAVAILABLE()
    }
    if (raw.driverName !== 'session') throw new E_MASQUERADE_UNAVAILABLE()
    let user: User
    try {
      user = await raw.authenticate()
    } catch (error) {
      if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
      throw new E_MASQUERADE_UNAVAILABLE()
    }
    try {
      const account = await this.#provider.createUserForGuard(user)
      return buildSubject(user, account.getId(), this.authority.incarnation)
    } catch {
      throw new E_MASQUERADE_UNAVAILABLE()
    }
  }
}
