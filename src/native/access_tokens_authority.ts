import type { AccessTokensAuthorityOptions, NativeAccessTokensAdapter } from '../types.ts'
import { E_MASQUERADE_NOT_ALLOWED, E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import { errors } from '@adonisjs/auth'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { NativeAuthority } from '../types.ts'
import { AccountAuthority, buildSubject } from './account_authority.ts'
import { isBoundedString } from '../bounded_string.ts'

/**
 * Authenticate native opaque tokens while sharing account-global authority state.
 *
 * @example
 * ```ts
 * import { accessTokensAuthority } from '@kevinjohn/adonisjs-masquerade/native'
 * import type { NativeSessionAdapter } from '@kevinjohn/adonisjs-masquerade/types'
 *
 * type Account = { id: string }
 * export function apiAuthority(
 *   web: NativeSessionAdapter<Account>,
 *   provider: AccessTokensUserProviderContract<Account>
 * ) {
 *   return accessTokensAuthority({
 *     guard: 'api',
 *     provider,
 *     ability: 'support:masquerade',
 *     authority: web.authority,
 *   })
 * }
 * ```
 */
export function accessTokensAuthority<User>(
  options: AccessTokensAuthorityOptions<User>
): NativeAccessTokensAdapter<User> {
  if (
    !options ||
    typeof options.provider?.createUserForGuard !== 'function' ||
    typeof options.provider.findById !== 'function' ||
    !isBoundedString(options.guard, 128) ||
    !isBoundedString(options.ability, 128) ||
    !options.ability.trim()
  )
    throw new InvalidArgumentsException('Invalid native access tokens authority')

  const { guard, provider, ability } = options
  let authority: NativeAuthority<User>
  if (options.authority) {
    if (
      Object.hasOwn(options, 'namespace') ||
      Object.hasOwn(options, 'incarnation') ||
      Object.hasOwn(options, 'securityStamp') ||
      Object.hasOwn(options, 'isActive')
    )
      throw new InvalidArgumentsException('Invalid native access tokens authority')
    authority = options.authority
    if (
      !isBoundedString(authority.namespace, 128) ||
      !isBoundedString(authority.guard, 128) ||
      (authority.incarnation !== 'id' && typeof authority.incarnation !== 'function') ||
      typeof authority.inspectAccount !== 'function'
    )
      throw new InvalidArgumentsException('Invalid native access tokens authority')
  } else {
    if (Object.hasOwn(options, 'authority'))
      throw new InvalidArgumentsException('Invalid native access tokens authority')
    const standalone = options as Extract<AccessTokensAuthorityOptions<User>, { authority?: never }>
    if (
      !isBoundedString(standalone.namespace, 128) ||
      typeof standalone.securityStamp !== 'function' ||
      typeof standalone.isActive !== 'function' ||
      !(standalone.incarnation === 'id' || typeof standalone.incarnation === 'function')
    )
      throw new InvalidArgumentsException('Invalid native access tokens authority')

    const namespace = standalone.namespace
    const incarnation =
      standalone.incarnation === 'id' ? 'id' : standalone.incarnation.bind(standalone)
    const securityStamp = standalone.securityStamp.bind(standalone)
    const isActive = standalone.isActive.bind(standalone)
    authority = new AccountAuthority({
      namespace,
      guard,
      provider,
      incarnation,
      securityStamp,
      isActive,
    })
  }

  return new AccessTokensAdapter(guard, provider, ability, authority)
}

class AccessTokensAdapter<User> implements NativeAccessTokensAdapter<User> {
  declare readonly authority: NativeAuthority<User>
  declare readonly guard: string
  declare readonly driverName: 'access_tokens'
  declare readonly authenticateActor: NativeAccessTokensAdapter<User>['authenticateActor']
  #provider: AccessTokensAuthorityOptions<User>['provider']
  #ability: string
  #incarnation: 'id' | ((user: User) => string)

  constructor(
    guard: string,
    provider: AccessTokensAuthorityOptions<User>['provider'],
    ability: string,
    authority: NativeAuthority<User>
  ) {
    this.authority = authority
    this.guard = guard
    this.driverName = 'access_tokens'
    this.#provider = provider
    this.#ability = ability
    this.#incarnation =
      authority.incarnation === 'id' ? 'id' : authority.incarnation.bind(authority)
    this.authenticateActor = this.#authenticateActor.bind(this)
    Object.freeze(this)
  }

  async #authenticateActor(ctx: HttpContext) {
    let raw: GuardContract<User & { currentAccessToken?: { allows(ability: string): unknown } }>
    try {
      raw = ctx.auth.use(this.guard as never) as GuardContract<
        User & { currentAccessToken?: { allows(ability: string): unknown } }
      >
    } catch {
      throw new E_MASQUERADE_UNAVAILABLE()
    }
    if (raw.driverName !== 'access_tokens') throw new E_MASQUERADE_UNAVAILABLE()
    let user: User & { currentAccessToken?: { allows(ability: string): unknown } }
    try {
      user = await raw.authenticate()
    } catch (error) {
      if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
      throw new E_MASQUERADE_UNAVAILABLE()
    }

    let allowed = false
    try {
      allowed = user.currentAccessToken?.allows(this.#ability) === true
    } catch {
      throw new E_MASQUERADE_UNAVAILABLE()
    }
    if (!allowed) throw new E_MASQUERADE_NOT_ALLOWED()

    try {
      const account = await this.#provider.createUserForGuard(user)
      return buildSubject(user, account.getId(), this.#incarnation)
    } catch {
      throw new E_MASQUERADE_UNAVAILABLE()
    }
  }
}
