import type { ApplicationService } from '@adonisjs/core/types'
import type { MasqueradeErrorCode } from './error_types.ts'
import type { NativeRuntimeAdapter } from './native/types.ts'

export type {
  MasqueradeBlockedBy,
  MasqueradeErrorCode,
  MasqueradeSetupErrorCode,
  MasqueradeSetupErrorField,
} from './error_types.ts'

/** Canonical provider identifier. */
export type SubjectId = string
/** UTC ISO 8601 timestamp. */
export type Instant = string
/** Mode row revision; every committed transition advances it by one. */
export type Revision = number
/** Opaque `<revision>.<nonce>` proof that the caller saw the current mode. */
export type ContextToken = string
/** Access of an active mode: `view` blocks unsafe requests; `edit` allows marked mutations. */
export type ModeAccess = 'view' | 'edit'
/** A provider user with its canonical ID and the incarnation of its current account lifetime. */
export interface Subject<User> {
  id: SubjectId
  incarnation: string
  user: User
}
/** `NativeAuthority.inspectAccount` result: the subject, current stamp and eligibility. */
export interface AccountSnapshot<User> {
  subject: Subject<User>
  /** Current account epoch, captured at start and checked on every active admission. */
  securityStamp: string
  active: boolean
}
/**
 * Host-owned account inspection, separate from native credential authentication.
 * IDs are canonical provider IDs; incarnation identifies an immutable account lifetime.
 * The inspected snapshot supplies the stamp at start and at admission. A missing account is null,
 * while operational failures reject. It never authenticates a target.
 */
export interface NativeAuthority<User> {
  namespace: string
  guard: string
  /** `'id'` reuses the ID; a function returns a value that changes when an ID is reused. */
  incarnation: 'id' | ((user: User) => string)
  /**
   * Load an account by canonical ID: `null` when missing; reject on operational failure.
   *
   * @example
   * ```ts
   * const account = await authority.inspectAccount('customer-42')
   * ```
   */
  inspectAccount(id: SubjectId): Promise<AccountSnapshot<User> | null>
}
/** Global eligibility, optional edit permission and request-local access; only literal true permits access. */
export interface MasqueradePermissions<User, Request> {
  /** Whether `actor` may masquerade as `target`; checked at start and on every active admission. */
  canMasquerade(input: {
    actor: Subject<User>
    target: Subject<User>
    reason?: string
    request?: Request
  }): boolean | Promise<boolean>
  /** Required to start or continue edit access; absent denies edit. */
  canEdit?(input: {
    actor: Subject<User>
    target: Subject<User>
    reason?: string
    request?: Request
  }): boolean | Promise<boolean>
  /** Request-local access, such as a tenant check; `false` rejects this request only (403). */
  canUseRequest?(input: {
    actor: Subject<User>
    target: Subject<User>
    request: Request
  }): boolean | Promise<boolean>
}
/** Identifies one actor's mode row: one row per namespace, actor ID and incarnation. */
export interface OwnerKey {
  namespace: string
  actorId: SubjectId
  actorIncarnation: string
}
interface RowBase extends OwnerKey {
  revision: Revision
  revisionNonce: string
  modeId: string
  lastTransitionId: string
  updatedAt: Instant
}
/** A persisted mode row with no active target. */
export interface IdleModeRow extends RowBase {
  state: 'idle'
  access: null
  targetId: null
  targetIncarnation: null
  actorStampHash: null
  targetStampHash: null
  reason: null
  startedAt: null
  expiresAt: null
}
/** A persisted mode row with an active target, access level and fixed expiry. */
export interface ActiveModeRow extends RowBase {
  state: 'active'
  access: ModeAccess
  targetId: SubjectId
  targetIncarnation: string
  actorStampHash: string
  targetStampHash: string
  /** Null when the reason requirement is optional and no reason was given. */
  reason: string | null
  startedAt: Instant
  expiresAt: Instant
}
/** One actor's persisted mode, idle or active. */
export type ModeRow = IdleModeRow | ActiveModeRow
/** Audit event kinds written when a mode changes. */
export type TransitionKind = 'started' | 'stopped' | 'expired' | 'invalidated'
/** Audit event kinds written for denied or no-op controls. */
export type ControlOutcomeKind = 'start_denied' | 'stop_denied' | 'control_noop'
/** All event kinds persisted in the audit ledger. */
export type EventKind = TransitionKind | ControlOutcomeKind
/** One `masquerade_events` record, written with its transition or as a control outcome. */
export interface AuditEvent extends OwnerKey {
  id: string
  modeId?: string
  targetId?: SubjectId
  targetIncarnation?: string
  /** Access level of the active row that produced this event. */
  access?: ModeAccess
  at: Instant
  kind: EventKind
  outcomeCode: string
  revision: Revision
  reason?: string
}
/** An audit event written atomically with a mode transition. */
export type TransitionEvent = AuditEvent & { kind: TransitionKind }
/** An audit event written without changing a mode row. */
export type ControlOutcomeEvent = AuditEvent & { kind: ControlOutcomeKind }
/** The transition event passed to emitter and logger observers, without the start reason. */
export type ObserverEvent = Readonly<Omit<TransitionEvent, 'reason'>>
/** The subsystem a diagnostic describes. */
export type DiagnosticCategory =
  'configuration' | 'store' | 'authority' | 'permissions' | 'control' | 'observer'
/** The operation a diagnostic describes. */
export type DiagnosticOperation =
  | 'validate'
  | 'open'
  | 'read'
  | 'compare_and_set'
  | 'record_control_outcome'
  | 'inspect_account'
  | 'security_stamp'
  | 'can_masquerade'
  | 'can_edit'
  | 'can_use_request'
  | 'start'
  | 'stop'
  | 'error_reporter'
/** A bounded diagnostic for `logger.error`; it carries no reason, user ID or stamp. */
export interface DiagnosticEntry {
  readonly category: DiagnosticCategory
  readonly operation: DiagnosticOperation
  readonly code: MasqueradeErrorCode
  readonly transitionId?: string
}
/** An indeterminate commit may have succeeded; callers recover through status, never blind retry. */
export type CasOutcome =
  | { status: 'applied'; transitionId: string }
  | { status: 'conflict' }
  | { status: 'indeterminate'; transitionId: string }
/** Input to `ControlStore.compareAndSet`: the expected revision, the next row and its event. */
export interface CompareAndSetInput {
  owner: OwnerKey
  expected: Revision | null
  next: ModeRow
  event: TransitionEvent
}
/**
 * Durable mode and audit storage. An implementation must pass the conformance suite in
 * `@kevinjohn/adonisjs-masquerade/testing`.
 */
export interface ControlStore {
  /** Test stores must expose this flag so production boot rejects them. */
  readonly testOnly?: boolean
  /**
   * Independent row snapshot for the complete owner key; null is authoritative absence.
   *
   * @example
   * ```ts
   * const row = await store.read({
   *   namespace: 'users',
   *   actorId: 'support-operator',
   *   actorIncarnation: '1',
   * })
   * ```
   */
  read(owner: OwnerKey): Promise<ModeRow | null>
  /**
   * Atomically match the expected revision (null means absent), replace the row and append its event.
   *
   * @example
   * ```ts
   * const outcome = await store.compareAndSet({
   *   owner,
   *   expected: current?.revision ?? null,
   *   next,
   *   event,
   * })
   * ```
   */
  compareAndSet(input: CompareAndSetInput): Promise<CasOutcome>
  /**
   * Append a required denial/no-op outcome without changing the owner's row or revision.
   *
   * @example
   * ```ts
   * await store.recordControlOutcome(deniedStart)
   * ```
   */
  recordControlOutcome(event: ControlOutcomeEvent): Promise<void>
  /**
   * At most limit expired active snapshots; pruning re-reads and uses CAS before clearing each.
   *
   * @example
   * ```ts
   * const expired = await store.expiredBatch({ now: new Date().toISOString(), limit: 100 })
   * ```
   */
  expiredBatch(input: { now: Instant; limit: number }): Promise<ModeRow[]>
  /**
   * At most limit active snapshots, oldest update first; operator commands re-read and use CAS.
   *
   * @example
   * ```ts
   * const active = await store.activeBatch({ limit: 100 })
   * ```
   */
  activeBatch(input: { limit: number }): Promise<ModeRow[]>
  /**
   * Delete at most limit events older than before. Never delete mode rows, including idle rows.
   *
   * @example
   * ```ts
   * const deleted = await store.pruneEvents({ before: '2026-01-01T00:00:00.000Z', limit: 100 })
   * ```
   */
  pruneEvents(input: { before: Instant; limit: number }): Promise<number>
}
/** Request-serving capabilities; operator housekeeping is optional for a host store. */
export type RequestControlStore = Pick<
  ControlStore,
  'testOnly' | 'read' | 'compareAndSet' | 'recordControlOutcome'
>
/** Masquerade configuration, validated by `defineConfig`. */
export interface MasqueradeConfig<User, Request, Store extends RequestControlStore = ControlStore> {
  /** Defaults to the native adapter's `authority` when the runtime builds. */
  authority?: NativeAuthority<User>
  /** May instead be registered through `MasqueradeCallbackRegistration`. */
  permissions?: MasqueradePermissions<User, Request>
  /** Opens the control store when the service is created. */
  store: () => Promise<Store>
  /** Default mode length, 60 to `maxDurationSeconds`; defaults to 900. */
  durationSeconds?: number
  /** Longest mode a start may request, 60 to 3600; defaults to 3600. */
  maxDurationSeconds?: number
  /** Optional host logger for transitions and diagnostics. */
  logger?: NonNullable<ServiceDependencies<User, Request>['logger']>
  contextEnforcement: 'report' | 'enforce'
  retention: { days: number } | 'host-managed'
  /** Defaults to optional; required rejects a start without a reason. */
  reason?: 'optional' | 'required'
}
/** Configuration input whose store factory receives the application. */
export type MasqueradeConfigOptions<
  User,
  Request,
  Store extends RequestControlStore = ControlStore,
> = Omit<MasqueradeConfig<User, Request, Store>, 'store'> & {
  /** Open the control store using the application once its services are registered. */
  store: (app: ApplicationService) => Promise<Store>
}
/** Callbacks an application provider registers through `MasqueradeCallbackRegistration`. */
export interface MasqueradeCallbacks<User, Request> {
  /** The native adapter; the package binds it as `NativeAdapter`. Its `authority` is the config's `authority`. */
  native?: NativeRuntimeAdapter & { readonly authority: NativeAuthority<User> }
  permissions?: MasqueradePermissions<User, Request>
}
/** Start control input. */
export interface StartInput {
  targetId: string | number
  /** Required only when the configured reason requirement is `required`. */
  reason?: string
  durationSeconds?: number
  expectedContext: ContextToken
  /** Defaults to view; edit requires the host `canEdit` callback to return `true`. */
  access?: ModeAccess
}
/** Stop control input: only the current context token. */
export interface StopInput {
  expectedContext: ContextToken
}
/** The actor's mode as returned by status, start and stop, with a fresh context token. */
export type ModeView = Readonly<
  | { isMasquerading: false; contextToken: ContextToken }
  | {
      isMasquerading: true
      contextToken: ContextToken
      targetId: SubjectId
      /** Fixed access level of this active mode. */
      access: ModeAccess
      startedAt: Instant
      expiresAt: Instant
    }
>
/** The frozen actor and effective identity admitted for one request. */
export type ResolvedContext = Readonly<
  {
    namespace: string
    actorId: SubjectId
    actorIncarnation: string
    effectiveId: SubjectId
    effectiveIncarnation: string
    contextToken: ContextToken
  } & (
    | { isMasquerading: false; modeId?: never; access?: never }
    | { isMasquerading: true; modeId: string; access: ModeAccess }
  )
>
/** The core service returned by `createMasqueradeService`. */
export interface MasqueradeService<Request> {
  /**
   * Start a mode for the authenticated actor.
   *
   * @throws `E_MASQUERADE_INVALID_INPUT`, `E_MASQUERADE_CONTEXT_REQUIRED`,
   *   `E_MASQUERADE_CONTEXT_CHANGED`, `E_MASQUERADE_ALREADY_ACTIVE`, `E_MASQUERADE_NOT_ALLOWED` or
   *   `E_MASQUERADE_UNAVAILABLE`.
   *
   * @example
   * ```ts
   * const started = await service.start(ctx, {
   *   targetId: 'customer-42',
   *   reason: 'Support ticket 42',
   *   expectedContext: submittedContextToken,
   * })
   * ```
   */
  start(request: Request, input: StartInput): Promise<ModeView>
  /**
   * End the actor's mode; an idle actor gets the idle view back.
   *
   * @throws `E_MASQUERADE_INVALID_INPUT`, `E_MASQUERADE_CONTEXT_REQUIRED`,
   *   `E_MASQUERADE_CONTEXT_CHANGED` or `E_MASQUERADE_UNAVAILABLE`.
   *
   * @example
   * ```ts
   * const idle = await service.stop(ctx, { expectedContext: submittedContextToken })
   * ```
   */
  stop(request: Request, input: StopInput): Promise<ModeView>
  /**
   * Read the actor's mode without changing it.
   *
   * @throws `E_MASQUERADE_UNAVAILABLE`.
   *
   * @example
   * ```ts
   * const mode = await service.status(ctx)
   * ```
   */
  status(request: Request): Promise<ModeView>
  /**
   * Admit the request once and return its frozen identity. An expired or invalid mode is cleared.
   *
   * @throws `E_MASQUERADE_CONTEXT_CHANGED`, `E_MASQUERADE_NOT_ALLOWED` or
   *   `E_MASQUERADE_UNAVAILABLE`.
   *
   * @example
   * ```ts
   * const identity = await service.resolve(ctx)
   * ```
   */
  resolve(request: Request): Promise<ResolvedContext>
  /**
   * Get the view from this request's admitted snapshot. If this request clears its own expired or
   * invalid mode, return the committed idle view. Business admission still refuses that request.
   * A concurrent transition conflict is reported as a context change.
   *
   * @example
   * ```ts
   * const mode = await service.resolveView(ctx)
   * ```
   */
  resolveView(request: Request): Promise<ModeView>
}
/** Runtime dependencies are ports, never serializable application configuration. */
export interface ServiceDependencies<User, Request> {
  environment: string
  /** Authenticate the actor through the raw native guard; native errors pass through unchanged. */
  authenticateActor(request: Request): Promise<Subject<User>>
  /** Replaces `new Date()` for expiry; tests inject a fixed clock. */
  clock?: () => Date
  emitter: {
    /** Receives `masquerade:<kind>` after each committed event; never awaited. */
    emit(name: string, event: ObserverEvent): unknown
  }
  logger: {
    /** Receives each committed event. */
    info(event: ObserverEvent): unknown
    /** Receives bounded diagnostics. */
    error(event: DiagnosticEntry): unknown
  }
  /** Receives errors thrown by observers; they never change a committed result. */
  observerErrorHandler: (error: unknown) => unknown
}

export type * from './native/types.ts'
export type * from './account_kit/types.ts'
export type * from './http/types.ts'
export type * from './plugins/types.ts'

/** One request's admitted masquerade state: its context, view, actor and effective subject. */
export interface RequestAdmission<User> {
  readonly context: ResolvedContext
  readonly view: ModeView
  readonly actor: Readonly<Subject<User>>
  readonly effective: Readonly<Subject<User>>
}

/** The credential transport a route resolves to. */
export type RouteGuardSelection =
  | { kind: 'none' | 'raw' | 'effective'; raw: string }
  // Several native guards on a route Masquerade does not own: native auth keeps working, but no
  // single adapter is selected, so any Masquerade operation on the route fails closed.
  | { kind: 'ambiguous' }

/** Effective user facade for a native opaque access-token guard. */
export type EffectiveAccessTokensUser<User> = User extends { currentAccessToken: unknown }
  ? Omit<User, 'currentAccessToken'>
  : User
