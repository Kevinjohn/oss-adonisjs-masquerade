import { E_UNAUTHORIZED_ACCESS } from '../errors.ts'
import type {
  AccountKitAccessSnapshot,
  AccountKitAdapter,
  AccountKitAuthorityOptions,
  AccountKitManagedGuard,
} from '../types.ts'
import { E_MASQUERADE_NOT_ALLOWED, E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import { errors } from '@adonisjs/auth'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type { GuardContract } from '@adonisjs/auth/types'
import type { NativeAuthority, Subject } from '../types.ts'
import { isBoundedString } from '../bounded_string.ts'
import { resolveAccountOwner, requireCanonicalId } from './account_owner.ts'

function isKitDenial(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && (error as { code?: unknown }).code === code
}

function stamp(revision: string | null): string {
  if (revision === null) return 'account-kit:null'
  if (typeof revision !== 'string' || !revision) throw new E_MASQUERADE_UNAVAILABLE()
  return `account-kit:revision:${revision}`
}

/**
 * One Account Kit credential transport and one coherent account authority.
 *
 * @example
 * ```ts
 * * import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit'
 * import type { AccountKitAuthorityOptions } from '@kevinjohn/adonisjs-masquerade/types'
 *
 * type Account = { id: string }
 * type SessionOptions = Extract<AccountKitAuthorityOptions<Account>, { ability?: never }>
 * export function supportNative({ kit, provider, managedGuard }: SessionOptions) {
 *   return accountKitAuthority({
 *     namespace: 'users',
 *     incarnation: 'id',
 *     kit,
 *     provider,
 *     managedGuard,
 *   })
 * }
 * ```
 */
export function accountKitAuthority<User>(
  options: AccountKitAuthorityOptions<User>
): AccountKitAdapter<User> {
  if (
    !options ||
    !isBoundedString(options.namespace, 128) ||
    !options.managedGuard ||
    !isBoundedString(options.managedGuard.name, 128) ||
    !['session', 'access_tokens'].includes(options.managedGuard.strategy) ||
    typeof options.managedGuard.current !== 'function' ||
    typeof options.kit !== 'function' ||
    typeof options.provider?.findById !== 'function' ||
    typeof options.provider.createUserForGuard !== 'function' ||
    !(options.incarnation === 'id' || typeof options.incarnation === 'function') ||
    (options.managedGuard.strategy === 'access_tokens' &&
      (!isBoundedString(options.ability, 128) || !options.ability?.trim())) ||
    (options.managedGuard.strategy === 'session' && options.ability !== undefined)
  )
    throw new InvalidArgumentsException('Invalid Account Kit authority')

  const { provider, kit } = options
  const guard = options.managedGuard.name
  const strategy = options.managedGuard.strategy
  const ability = options.ability
  const managedGuard = Object.freeze(
    Object.create(options.managedGuard, {
      name: { value: guard, enumerable: true },
      strategy: { value: strategy, enumerable: true },
      current: { value: options.managedGuard.current.bind(options.managedGuard), enumerable: true },
    })
  ) as AccountKitManagedGuard
  const incarnation = options.incarnation === 'id' ? 'id' : options.incarnation.bind(options)
  const buildAccountSubject = (user: User, idValue: unknown): Subject<User> => ({
    ...resolveAccountOwner(incarnation, user, idValue),
    user,
  })
  const authority: NativeAuthority<User> = Object.freeze({
    namespace: options.namespace,
    guard,
    incarnation,
    async inspectAccount(id: string) {
      let snapshot: AccountKitAccessSnapshot
      try {
        const service = await kit()
        snapshot = await service.authentication.inspectAccountAccess({
          userId: id,
          requireActive: true,
        })
      } catch (error) {
        if (isKitDenial(error, 'E_ACCOUNT_KIT_ACCOUNT_ACCESS_DENIED')) return null
        throw error
      }
      const canonical = requireCanonicalId(snapshot.account.id)
      // A database may coerce a non-canonical ID such as "02" to an existing account. Answer with
      // the generic denial, as for a missing account, so the response does not reveal existence.
      if (canonical !== id) return null
      const account = await provider.findById(canonical)
      if (!account) return null
      if (requireCanonicalId(account.getId()) !== canonical) throw new E_MASQUERADE_UNAVAILABLE()
      const user = account.getOriginal()
      if (!user || typeof user !== 'object') throw new E_MASQUERADE_UNAVAILABLE()
      return {
        subject: buildAccountSubject(user, canonical),
        active: snapshot.account.active,
        securityStamp: stamp(snapshot.revision),
      }
    },
  })
  return Object.freeze({
    authority,
    guard,
    driverName: strategy,
    managedGuard,
    kit,
    provider,
    async authenticateActor(ctx: HttpContext) {
      let raw: GuardContract<User & { currentAccessToken?: { allows(ability: string): unknown } }>
      try {
        raw = ctx.auth.use(guard as never) as typeof raw
      } catch {
        throw new E_MASQUERADE_UNAVAILABLE()
      }
      if (raw.driverName !== strategy) throw new E_MASQUERADE_UNAVAILABLE()
      let user: User & { currentAccessToken?: { allows(ability: string): unknown } }
      try {
        user = await raw.authenticate()
      } catch (error) {
        if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
        throw new E_MASQUERADE_UNAVAILABLE()
      }
      if (ability) {
        let allowed = false
        try {
          allowed = user.currentAccessToken?.allows(ability) === true
        } catch {
          throw new E_MASQUERADE_UNAVAILABLE()
        }
        if (!allowed) throw new E_MASQUERADE_NOT_ALLOWED()
      }
      try {
        const input = await managedGuard.current(ctx)
        const service = await kit()
        const account = await service.authentication.current(input)
        const providerAccount = await provider.createUserForGuard(user)
        const id = requireCanonicalId(providerAccount.getId())
        if (requireCanonicalId(account.id) !== id || requireCanonicalId(input.userId) !== id)
          throw new E_MASQUERADE_UNAVAILABLE()
        return buildAccountSubject(user, id)
      } catch (error) {
        if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
        if (isKitDenial(error, 'E_ACCOUNT_KIT_INVALID_SESSION'))
          throw new E_UNAUTHORIZED_ACCESS('Invalid session', {
            guardDriverName: strategy,
          })
        throw new E_MASQUERADE_UNAVAILABLE()
      }
    },
  })
}
