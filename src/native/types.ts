import type { HttpContext } from '@adonisjs/core/http'
import type { SessionUserProviderContract } from '@adonisjs/auth/types/session'
import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
import type { NativeAuthority, Subject } from '../types.ts'

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
  /**
   * Declare `'session'` when the adapter's raw guard uses the session driver, so boot rejects an
   * effective guard wired to another transport; omit it to defer every driver check to the live
   * effective-route request.
   */
  readonly driverName?: 'session'
  /**
   * Authenticate through the raw session guard; `E_UNAUTHORIZED_ACCESS` passes through unchanged.
   *
   * @example
   * ```ts
   * const actor = await adapter.authenticateActor(ctx)
   * ```
   */
  authenticateActor(ctx: HttpContext): Promise<Subject<User>>
}

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
   * Declare `'access_tokens'` when the adapter's raw guard uses the access-tokens driver, so boot
   * rejects an effective guard wired to another transport; omit it to defer every driver check to
   * the live effective-route request.
   */
  readonly driverName?: 'access_tokens'
  /**
   * Authenticate through the raw access-tokens guard; `E_UNAUTHORIZED_ACCESS` passes through.
   *
   * @throws `E_MASQUERADE_NOT_ALLOWED` when the token lacks the ability, or
   *   `E_MASQUERADE_UNAVAILABLE`.
   *
   * @example
   * ```ts
   * const actor = await adapter.authenticateActor(ctx)
   * ```
   */
  authenticateActor(ctx: HttpContext): Promise<Subject<User>>
}

/** The result of `nativeAuthorities`: the primary authority and one adapter per raw guard. */
export interface NativeAuthorityComposition<Primary extends NativeRuntimeAdapter> {
  readonly authority: Primary['authority']
  readonly guard?: string
  readonly adapters: Readonly<Record<string, NativeRuntimeAdapter>>
  /**
   * Authenticate using the primary native adapter.
   *
   * @example
   * ```ts
   * const actor = await composition.authenticateActor(ctx)
   * ```
   */
  authenticateActor: Primary['authenticateActor']
}

/** A value `stampFrom` can hash; convert dates and other objects to a stable string first. */
export type StampField = string | number | boolean | bigint | null

/** Model-erased container boundary; concrete adapters retain their own User typing. */
export interface NativeRuntimeAdapter {
  readonly authority: { readonly namespace: string; readonly guard: string }
  /** Raw native guard selected for this adapter when it differs from authority.guard. */
  readonly guard?: string
  /** Expected native transport, when known without constructing a request guard. */
  readonly driverName?: 'session' | 'access_tokens'
  /** Native adapters keyed by their raw Auth guard name when multiple transports share an authority. */
  readonly adapters?: Readonly<Record<string, NativeRuntimeAdapter>>
  /**
   * Authenticate the actor through this adapter's raw guard.
   *
   * @example
   * ```ts
   * const actor = await adapter.authenticateActor(ctx)
   * ```
   */
  authenticateActor(ctx: HttpContext): Promise<Subject<unknown>>
}
