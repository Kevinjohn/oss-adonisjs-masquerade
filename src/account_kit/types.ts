import type { HttpContext } from '@adonisjs/core/http'
import type { NativeAuthority, NativeRuntimeAdapter, Subject } from '../types.ts'
import type { accountKitAuthority } from './authority.ts'

/** An account or token identifier as Account Kit reports it; Masquerade compares canonical strings. */
export type AccountKitIdentifier = string | number | bigint
/** The credential reference a managed guard reads from the current request. */
export type AccountKitAccountInput = {
  /** The authenticated account. */
  userId: AccountKitIdentifier
  /** The account revision the credential was issued under, when the transport records one. */
  revision?: string | null
  /** The access token, for the `access_tokens` strategy. */
  tokenId?: AccountKitIdentifier
  /** The session handle, for the `session` strategy. */
  sessionHandle?: string
}
/** Account Kit's answer to an account access inspection. */
export type AccountKitAccessSnapshot = {
  /** The inspected account and whether it is active. */
  account: { id: AccountKitIdentifier; active: boolean }
  /** The account revision; Masquerade derives the security stamp from it. */
  revision: string | null
}
/** The parts of the Account Kit service Masquerade calls. */
export interface AccountKitService {
  /** Account authentication queries. */
  authentication: {
    /** Inspect an account by canonical ID; a denial means the account is not eligible. */
    inspectAccountAccess(input: {
      userId: string
      requireActive: true
    }): Promise<AccountKitAccessSnapshot>
    /** Resolve the account behind the current managed credential. */
    current(input: AccountKitAccountInput): Promise<{ id: AccountKitIdentifier }>
  }
  /** Managed HTTP registration, checked by the Account Kit provider at startup. */
  managedHttp?: {
    /** Throw unless the managed guard is the one Account Kit registered. */
    assertGuard(guard: AccountKitManagedGuard): unknown
  }
}
/** The Account Kit managed guard that authenticates the actor. */
export interface AccountKitManagedGuard {
  /** The raw Auth guard name. */
  name: string
  /** The credential transport of that guard. */
  strategy: 'session' | 'access_tokens'
  /** Read the current request's credential reference. */
  current(ctx: HttpContext): Promise<AccountKitAccountInput>
}
/** The host user provider shared with the managed guard. */
export interface AccountKitUserProvider<User> {
  /** Wrap an authenticated user as a guard user. */
  createUserForGuard(user: User): Promise<{
    /** The provider ID of the user. */
    getId(): unknown
    /** The host user object. */
    getOriginal(): User
  }>
  /** Load a user by canonical ID, or `null` when none exists. */
  findById(id: string): Promise<{
    /** The provider ID of the user. */
    getId(): unknown
    /** The host user object. */
    getOriginal(): User
  } | null>
}
/**
 * Options for {@link accountKitAuthority}. A session guard takes no `ability`; an access-token
 * guard requires the token ability that permits masquerade controls.
 */
export type AccountKitAuthorityOptions<User> = {
  /** Stable identity domain for mode rows; at most 128 bytes. */
  namespace: string
  /** `'id'` or a callback returning the account's immutable incarnation. */
  incarnation: 'id' | ((user: User) => string)
  /** Resolve the Account Kit service. */
  kit(): Promise<AccountKitService> | AccountKitService
  /** The user provider the managed guard uses. */
  provider: AccountKitUserProvider<User>
} & (
  | {
      managedGuard: AccountKitManagedGuard & { strategy: 'session' }
      ability?: never
    }
  | {
      managedGuard: AccountKitManagedGuard & { strategy: 'access_tokens' }
      ability: string
    }
)
/** The native adapter bound as `NativeAdapter` for an Account Kit host. */
export interface AccountKitAdapter<User> extends NativeRuntimeAdapter {
  /** The account authority Masquerade uses for inspection and stamps. */
  readonly authority: NativeAuthority<User>
  /** The raw Auth guard name. */
  readonly guard: string
  /** The managed guard the adapter was built with. */
  readonly managedGuard: AccountKitManagedGuard
  /** Resolve the Account Kit service. */
  readonly kit: AccountKitAuthorityOptions<User>['kit']
  /** The user provider the managed guard uses. */
  readonly provider: AccountKitUserProvider<User>
  /**
   * Authenticate the actor through the managed guard and Account Kit.
   *
   * @example
   * ```ts
   * const actor = await adapter.authenticateActor(ctx)
   * ```
   */
  authenticateActor(ctx: HttpContext): Promise<Subject<User>>
}
