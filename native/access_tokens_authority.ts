import { errors } from '@adonisjs/auth'
import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { NativeRuntimeAdapter } from '../integration/native_binding.js'
import type { NativeAuthority, Subject } from '../src/types.js'
import { boundedString } from '../src/bounded_string.js'
import { MasqueradeError, unavailable } from '../src/errors.js'

interface AccessTokensAuthorityBase<User> {
  guard: string
  provider: AccessTokensUserProviderContract<User>
  ability: string
}
interface SharedAuthorityOptions<User> extends AccessTokensAuthorityBase<User> {
  authority: NativeAuthority<User>
  namespace?: never
  incarnation?: never
  securityStamp?: never
  isActive?: never
}
interface StandaloneAuthorityOptions<User> extends AccessTokensAuthorityBase<User> {
  authority?: never
  namespace: string
  incarnation: 'id' | ((user: User) => string)
  securityStamp(user: User): string | Promise<string>
  isActive(user: User): boolean | Promise<boolean>
}
/**
 * Options for `accessTokensAuthority`: either share an existing `authority`, or supply the
 * standalone `namespace`, `incarnation`, `securityStamp` and `isActive` fields. `ability` names the
 * token ability the actor's token must allow.
 */
export type AccessTokensAuthorityOptions<User> =
  SharedAuthorityOptions<User> | StandaloneAuthorityOptions<User>

export interface NativeAccessTokensAdapter<User = unknown> extends NativeRuntimeAdapter {
  readonly authority: NativeAuthority<User>
  readonly guard: string
  /**
   * Authenticate through the raw access-tokens guard; `E_UNAUTHORIZED_ACCESS` passes through.
   *
   * @throws {MasqueradeError} `E_MASQUERADE_NOT_ALLOWED` when the token lacks the ability, or
   *   `E_MASQUERADE_UNAVAILABLE`.
   */
  authenticateActor(ctx: HttpContext): Promise<Subject<User>>
}

/** Authenticate native opaque tokens while sharing account-global authority state. */
export function accessTokensAuthority<User>(
  options: AccessTokensAuthorityOptions<User>
): NativeAccessTokensAdapter<User> {
  if (
    !options ||
    typeof options.provider?.createUserForGuard !== 'function' ||
    typeof options.provider.findById !== 'function' ||
    !boundedString(options.guard, 128) ||
    !boundedString(options.ability, 128) ||
    !options.ability.trim()
  )
    throw new TypeError('Invalid native access tokens authority')

  const { guard, provider, ability } = options
  let authority: NativeAuthority<User>
  if (options.authority) {
    if (
      Object.hasOwn(options, 'namespace') ||
      Object.hasOwn(options, 'incarnation') ||
      Object.hasOwn(options, 'securityStamp') ||
      Object.hasOwn(options, 'isActive')
    )
      throw new TypeError('Invalid native access tokens authority')
    authority = options.authority
    if (
      !boundedString(authority.namespace, 128) ||
      !boundedString(authority.guard, 128) ||
      (authority.incarnation !== 'id' && typeof authority.incarnation !== 'function') ||
      typeof authority.securityStamp !== 'function' ||
      typeof authority.inspectAccount !== 'function'
    )
      throw new TypeError('Invalid native access tokens authority')
  } else {
    if (Object.hasOwn(options, 'authority'))
      throw new TypeError('Invalid native access tokens authority')
    const standalone = options as StandaloneAuthorityOptions<User>
    if (
      !boundedString(standalone.namespace, 128) ||
      typeof standalone.securityStamp !== 'function' ||
      typeof standalone.isActive !== 'function' ||
      !(standalone.incarnation === 'id' || typeof standalone.incarnation === 'function')
    )
      throw new TypeError('Invalid native access tokens authority')

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
        if (typeof active !== 'boolean') throw unavailable()
        return {
          subject: subject(user, account.getId(), incarnation),
          active,
          securityStamp: await securityStamp(user),
        }
      },
    }
    Object.freeze(authority)
  }

  const incarnation: 'id' | ((user: User) => string) =
    authority.incarnation === 'id' ? 'id' : authority.incarnation.bind(authority)
  function subject(
    user: User,
    identifier: unknown,
    configuredIncarnation: 'id' | ((user: User) => string) = incarnation
  ): Subject<User> {
    if (
      typeof identifier !== 'string' &&
      typeof identifier !== 'bigint' &&
      !(typeof identifier === 'number' && Number.isSafeInteger(identifier))
    )
      throw unavailable()
    const id = String(identifier)
    const accountIncarnation = configuredIncarnation === 'id' ? id : configuredIncarnation(user)
    if (!boundedString(id, 255) || !boundedString(accountIncarnation, 128)) throw unavailable()
    return { id, incarnation: accountIncarnation, user }
  }

  return Object.freeze({
    authority,
    guard,
    async authenticateActor(ctx: HttpContext) {
      let raw: GuardContract<User & { currentAccessToken?: { allows(ability: string): unknown } }>
      try {
        raw = ctx.auth.use(guard as never) as GuardContract<
          User & { currentAccessToken?: { allows(ability: string): unknown } }
        >
      } catch {
        throw unavailable()
      }
      if (raw.driverName !== 'access_tokens') throw unavailable()
      let user: User & { currentAccessToken?: { allows(ability: string): unknown } }
      try {
        user = await raw.authenticate()
      } catch (error) {
        if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
        throw unavailable()
      }

      let allowed = false
      try {
        allowed = user.currentAccessToken?.allows(ability) === true
      } catch {
        throw unavailable()
      }
      if (!allowed) throw new MasqueradeError('E_MASQUERADE_NOT_ALLOWED')

      try {
        const account = await provider.createUserForGuard(user)
        return subject(user, account.getId())
      } catch {
        throw unavailable()
      }
    },
  })
}
