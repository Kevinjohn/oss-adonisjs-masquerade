import type { SessionAuthorityOptions, NativeSessionAdapter } from '../types.ts'
import { E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import { errors } from '@adonisjs/auth'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type {} from '@adonisjs/auth/initialize_auth_middleware'
import type { GuardContract } from '@adonisjs/auth/types'
import type { NativeAuthority, Subject } from '../types.ts'
import { isBoundedString } from '../bounded_string.ts'

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
  function buildSubject(user: User, identifier: unknown): Subject<User> {
    if (!(
      typeof identifier === 'string' ||
      typeof identifier === 'bigint' ||
      (typeof identifier === 'number' && Number.isSafeInteger(identifier))
    ))
      throw new E_MASQUERADE_UNAVAILABLE()
    const id = String(identifier)
    const accountIncarnation = incarnation === 'id' ? id : incarnation(user)
    if (!isBoundedString(id, 255) || !isBoundedString(accountIncarnation, 128))
      throw new E_MASQUERADE_UNAVAILABLE()
    return { id, incarnation: accountIncarnation, user }
  }
  const authority: NativeAuthority<User> = {
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
        subject: buildSubject(user, account.getId()),
        active,
        securityStamp: await securityStamp(user),
      }
    },
  }
  return Object.freeze({
    authority: Object.freeze(authority),
    driverName: 'session' as const,
    async authenticateActor(ctx: HttpContext) {
      let raw: GuardContract<User>
      try {
        raw = ctx.auth.use(guard as never) as GuardContract<User>
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
        const account = await provider.createUserForGuard(user)
        return buildSubject(user, account.getId())
      } catch {
        throw new E_MASQUERADE_UNAVAILABLE()
      }
    },
  })
}
