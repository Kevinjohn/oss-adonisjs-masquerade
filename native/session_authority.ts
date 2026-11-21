import { errors } from '@adonisjs/auth'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type {} from '@adonisjs/auth/initialize_auth_middleware'
import type { GuardContract } from '@adonisjs/auth/types'
import type { SessionUserProviderContract } from '@adonisjs/auth/types/session'
import type { NativeAuthority, Subject } from '../src/types.js'
import { isBoundedString } from '../src/bounded_string.js'
import { createUnavailableError } from '../src/error_helpers.js'

/** Options for `sessionAuthority`. */
export interface SessionAuthorityOptions<User> {
  namespace: string
  /** The raw session guard that authenticates the actor. */
  guard: string
  /** The same user provider the raw session guard uses. */
  provider: SessionUserProviderContract<User>
  /** `'id'` reuses the ID; a function returns a value that changes when an ID is reused. */
  incarnation: 'id' | ((user: User) => string)
  /** Current account epoch; change it on password, privilege, suspension and logout-all changes. */
  securityStamp(user: User): string | Promise<string>
  /** Whether the account may act or be targeted; must return a boolean. */
  isActive(user: User): boolean | Promise<boolean>
}
/** The native session adapter: account authority plus raw-guard actor authentication. */
export interface NativeSessionAdapter<User = unknown> {
  readonly authority: NativeAuthority<User>
  readonly driverName?: 'session'
  /** Authenticate through the raw session guard; `E_UNAUTHORIZED_ACCESS` passes through unchanged. */
  authenticateActor(ctx: HttpContext): Promise<Subject<User>>
}
/** Use the same public user provider as the raw native session guard. */
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
  function subject(user: User, identifier: unknown): Subject<User> {
    if (!(
      typeof identifier === 'string' ||
      typeof identifier === 'bigint' ||
      (typeof identifier === 'number' && Number.isSafeInteger(identifier))
    ))
      throw createUnavailableError()
    const id = String(identifier)
    const accountIncarnation = incarnation === 'id' ? id : incarnation(user)
    if (!isBoundedString(id, 255) || !isBoundedString(accountIncarnation, 128))
      throw createUnavailableError()
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
      if (typeof active !== 'boolean') throw createUnavailableError()
      return {
        subject: subject(user, account.getId()),
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
        throw createUnavailableError()
      }
      if (raw.driverName !== 'session') throw createUnavailableError()
      let user: User
      try {
        user = await raw.authenticate()
      } catch (error) {
        if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
        throw createUnavailableError()
      }
      try {
        const account = await provider.createUserForGuard(user)
        return subject(user, account.getId())
      } catch {
        throw createUnavailableError()
      }
    },
  })
}
