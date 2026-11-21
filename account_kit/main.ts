import { errors } from '@adonisjs/auth'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type { GuardContract } from '@adonisjs/auth/types'
import type { NativeRuntimeAdapter } from '../src/integration/native_binding.js'
import type { NativeAuthority, Subject } from '../src/types.js'
import { isBoundedString } from '../src/bounded_string.js'
import { MasqueradeError } from '../src/errors.js'
import { createUnavailableError } from '../src/error_helpers.js'
import { accountOwner, canonicalId } from './account_owner.js'

type Identifier = string | number | bigint
type AccountInput = {
  userId: Identifier
  revision?: string | null
  tokenId?: Identifier
  sessionHandle?: string
}
type AccountKitSnapshot = { account: { id: Identifier; active: boolean }; revision: string | null }
export interface AccountKitService {
  authentication: {
    inspectAccountAccess(input: {
      userId: string
      requireActive: true
    }): Promise<AccountKitSnapshot>
    current(input: AccountInput): Promise<{ id: Identifier }>
  }
  managedHttp?: { assertGuard(guard: AccountKitManagedGuard): unknown }
}
export interface AccountKitManagedGuard {
  name: string
  strategy: 'session' | 'access_tokens'
  current(ctx: HttpContext): Promise<AccountInput>
}
export interface AccountKitUserProvider<User> {
  createUserForGuard(user: User): Promise<{ getId(): unknown; getOriginal(): User }>
  findById(id: string): Promise<{ getId(): unknown; getOriginal(): User } | null>
}
interface AccountKitAuthorityBase<User> {
  namespace: string
  incarnation: 'id' | ((user: User) => string)
  kit(): Promise<AccountKitService> | AccountKitService
  provider: AccountKitUserProvider<User>
}
export type AccountKitAuthorityOptions<User> = AccountKitAuthorityBase<User> &
  (
    | {
        managedGuard: AccountKitManagedGuard & { strategy: 'session' }
        ability?: never
      }
    | {
        managedGuard: AccountKitManagedGuard & { strategy: 'access_tokens' }
        ability: string
      }
  )
export interface AccountKitAdapter<User> extends NativeRuntimeAdapter {
  readonly authority: NativeAuthority<User>
  readonly guard: string
  readonly managedGuard: AccountKitManagedGuard
  readonly kit: AccountKitAuthorityOptions<User>['kit']
  readonly provider: AccountKitUserProvider<User>
  authenticateActor(ctx: HttpContext): Promise<Subject<User>>
}

async function isKitDenial(error: unknown, name: string, code: string): Promise<boolean> {
  if (!error || typeof error !== 'object') return false
  if ((error as { code?: unknown }).code === code) return true
  try {
    // Only an Account Kit error path resolves the optional peer; core and construction stay lazy.
    const path = '@kevinjohn/adonisjs-account-kit/errors'
    const kitErrors = (await import(path)) as Record<string, unknown>
    const errorClass = kitErrors[name]
    return typeof errorClass === 'function' && error instanceof errorClass
  } catch {
    return false
  }
}

function stamp(revision: string | null): string {
  if (revision === null) return 'account-kit:null'
  if (typeof revision !== 'string' || !revision) throw createUnavailableError()
  return `account-kit:revision:${revision}`
}

/** One Account Kit credential transport and one coherent account authority. */
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
  const subject = (user: User, idValue: unknown): Subject<User> => ({
    ...accountOwner(incarnation, user, idValue),
    user,
  })
  const authority: NativeAuthority<User> = Object.freeze({
    namespace: options.namespace,
    guard,
    incarnation,
    async inspectAccount(id: string) {
      let snapshot: AccountKitSnapshot
      try {
        const service = await kit()
        snapshot = await service.authentication.inspectAccountAccess({
          userId: id,
          requireActive: true,
        })
      } catch (error) {
        if (
          await isKitDenial(
            error,
            'AccountAccessDeniedError',
            'E_ACCOUNT_KIT_ACCOUNT_ACCESS_DENIED'
          )
        )
          return null
        throw error
      }
      const canonical = canonicalId(snapshot.account.id)
      // A database may coerce a non-canonical ID such as "02" to an existing account. Answer with
      // the generic denial, as for a missing account, so the response does not reveal existence.
      if (canonical !== id) return null
      const account = await provider.findById(canonical)
      if (!account) return null
      if (canonicalId(account.getId()) !== canonical) throw createUnavailableError()
      const user = account.getOriginal()
      if (!user || typeof user !== 'object') throw createUnavailableError()
      return {
        subject: subject(user, canonical),
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
        throw createUnavailableError()
      }
      if (raw.driverName !== strategy) throw createUnavailableError()
      let user: User & { currentAccessToken?: { allows(ability: string): unknown } }
      try {
        user = await raw.authenticate()
      } catch (error) {
        if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
        throw createUnavailableError()
      }
      if (ability) {
        let allowed = false
        try {
          allowed = user.currentAccessToken?.allows(ability) === true
        } catch {
          throw createUnavailableError()
        }
        if (!allowed) throw new MasqueradeError('E_MASQUERADE_NOT_ALLOWED')
      }
      try {
        const input = await managedGuard.current(ctx)
        const service = await kit()
        const account = await service.authentication.current(input)
        const providerAccount = await provider.createUserForGuard(user)
        const id = canonicalId(providerAccount.getId())
        if (canonicalId(account.id) !== id || canonicalId(input.userId) !== id)
          throw createUnavailableError()
        return subject(user, id)
      } catch (error) {
        if (error instanceof errors.E_UNAUTHORIZED_ACCESS) throw error
        if (await isKitDenial(error, 'InvalidSessionError', 'E_ACCOUNT_KIT_INVALID_SESSION'))
          throw new errors.E_UNAUTHORIZED_ACCESS('Invalid session', {
            guardDriverName: strategy,
          })
        throw createUnavailableError()
      }
    },
  })
}
