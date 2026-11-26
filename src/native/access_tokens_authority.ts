import type { AccessTokensAuthorityOptions, NativeAccessTokensAdapter } from '../types.ts'
import { E_MASQUERADE_NOT_ALLOWED, E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import { errors } from '@adonisjs/auth'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { NativeAuthority, Subject } from '../types.ts'
import { isBoundedString } from '../bounded_string.ts'

/**
 * Authenticate native opaque tokens while sharing account-global authority state.
 *
 * @example
 * ```ts
 * * import { accessTokensAuthority } from '@kevinjohn/adonisjs-masquerade/native'
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
    authority = {
      namespace,
      guard,
      incarnation,
      securityStamp,
      async inspectAccount(id) {
        const account = await provider.findById(id)
        if (!account) return null
        const user = account.getOriginal()
        const active = await isActive(user)
        if (typeof active !== 'boolean') throw new E_MASQUERADE_UNAVAILABLE()
        return {
          subject: buildSubject(user, account.getId(), incarnation),
          active,
          securityStamp: await securityStamp(user),
        }
      },
    }
    Object.freeze(authority)
  }

  const incarnation: 'id' | ((user: User) => string) =
    authority.incarnation === 'id' ? 'id' : authority.incarnation.bind(authority)
  function buildSubject(
    user: User,
    identifier: unknown,
    configuredIncarnation: 'id' | ((user: User) => string) = incarnation
  ): Subject<User> {
    if (
      typeof identifier !== 'string' &&
      typeof identifier !== 'bigint' &&
      !(typeof identifier === 'number' && Number.isSafeInteger(identifier))
    )
      throw new E_MASQUERADE_UNAVAILABLE()
    const id = String(identifier)
    const accountIncarnation = configuredIncarnation === 'id' ? id : configuredIncarnation(user)
    if (!isBoundedString(id, 255) || !isBoundedString(accountIncarnation, 128))
      throw new E_MASQUERADE_UNAVAILABLE()
    return { id, incarnation: accountIncarnation, user }
  }

  return Object.freeze({
    authority,
    guard,
    driverName: 'access_tokens' as const,
    async authenticateActor(ctx: HttpContext) {
      let raw: GuardContract<User & { currentAccessToken?: { allows(ability: string): unknown } }>
      try {
        raw = ctx.auth.use(guard as never) as GuardContract<
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
        allowed = user.currentAccessToken?.allows(ability) === true
      } catch {
        throw new E_MASQUERADE_UNAVAILABLE()
      }
      if (!allowed) throw new E_MASQUERADE_NOT_ALLOWED()

      try {
        const account = await provider.createUserForGuard(user)
        return buildSubject(user, account.getId())
      } catch {
        throw new E_MASQUERADE_UNAVAILABLE()
      }
    },
  })
}
