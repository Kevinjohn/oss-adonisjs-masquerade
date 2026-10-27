import type { MasqueradeErrorCode } from './errors.js'

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
  /** Current account epoch; must match `securityStamp(subject.user)` for the same account state. */
  securityStamp: string
  active: boolean
}
/**
 * Host-owned account inspection, separate from native credential authentication.
 * IDs are canonical provider IDs; incarnation identifies an immutable account lifetime.
 * securityStamp is captured at start; inspectAccount's snapshot stamp is checked on each active
 * admission. Both values must represent the same current account epoch. A missing account is null,
 * while operational failures reject. It never authenticates a target.
 */
export interface NativeAuthority<User> {
  namespace: string
  guard: string
  /** `'id'` reuses the ID; a function returns a value that changes when an ID is reused. */
  incarnation: 'id' | ((user: User) => string)
  /** Current account epoch for `user`; captured as a hash when a mode starts. */
  securityStamp(user: User): string | Promise<string>
  /** Load an account by canonical ID: `null` when missing; reject on operational failure. */
  inspectAccount(id: SubjectId): Promise<AccountSnapshot<User> | null>
}
/** Global eligibility, optional edit permission and request-local access; only literal true permits access. */
export interface MasqueradePolicy<User, Request> {
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
  /** Null when the host's reason policy is optional and no reason was given. */
  reason: string | null
  startedAt: Instant
  expiresAt: Instant
}
/** One actor's persisted mode, idle or active. */
export type ModeRow = IdleModeRow | ActiveModeRow
/** Audit event kinds: committed transitions and recorded control outcomes. */
export type EventKind =
  | 'started'
  | 'stopped'
  | 'expired'
  | 'invalidated'
  | 'start_denied'
  | 'stop_denied'
  | 'control_noop'
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
/** The audit event passed to emitter and logger observers, without the start reason. */
export type ObserverEvent = Readonly<Omit<AuditEvent, 'reason'>>
/** The subsystem a diagnostic describes. */
export type DiagnosticCategory =
  'configuration' | 'store' | 'authority' | 'policy' | 'control' | 'observer'
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
export interface DiagnosticEvent {
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
  event: AuditEvent
}
/**
 * Durable mode and audit storage. An implementation must pass the conformance suite in
 * `adonisjs-masquerade/testing`.
 */
export interface ControlStore {
  /** Test stores must expose this flag so production boot rejects them. */
  readonly testOnly?: boolean
  /** Independent row snapshot for the complete owner key; null is authoritative absence. */
  read(owner: OwnerKey): Promise<ModeRow | null>
  /** Atomically match the expected revision (null means absent), replace the row and append its event. */
  compareAndSet(input: CompareAndSetInput): Promise<CasOutcome>
  /** Append a required denial/no-op outcome without changing the owner's row or revision. */
  recordControlOutcome(event: AuditEvent): Promise<void>
  /** At most limit expired active snapshots; pruning re-reads and uses CAS before clearing each. */
  expiredBatch(input: { now: Instant; limit: number }): Promise<ModeRow[]>
  /** At most limit active snapshots, oldest update first; operator commands re-read and use CAS. */
  activeBatch(input: { limit: number }): Promise<ModeRow[]>
  /** Delete at most limit events older than before. Never delete mode rows, including idle rows. */
  pruneEvents(input: { before: Instant; limit: number }): Promise<number>
}
/** Masquerade configuration, validated by `defineConfig`. */
export interface MasqueradeConfig<User, Request> {
  authority: NativeAuthority<User>
  policy: MasqueradePolicy<User, Request>
  /** Opens the control store when the service is created. */
  store: () => Promise<ControlStore>
  /** Default mode length, 60 to `maxDurationSeconds`; defaults to 900. */
  durationSeconds?: number
  /** Longest mode a start may request, 60 to 3600; defaults to 3600. */
  maxDurationSeconds?: number
  contextEnforcement: 'report' | 'enforce'
  retention: { days: number } | 'host-managed'
  /** Defaults to optional; required rejects a start without a reason. */
  reason?: 'optional' | 'required'
}
/** Start control input. */
export interface StartInput {
  targetId: string | number
  /** Required only when the configured reason policy is required. */
  reason?: string
  durationSeconds?: number
  expectedContext: ContextToken
  /** Defaults to view; edit requires explicit host policy permission. */
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
export interface ResolvedContext {
  readonly namespace: string
  readonly actorId: SubjectId
  readonly actorIncarnation: string
  readonly effectiveId: SubjectId
  readonly effectiveIncarnation: string
  readonly isMasquerading: boolean
  readonly contextToken: ContextToken
  readonly modeId?: string
  /** Present exactly while masquerading. */
  readonly access?: ModeAccess
}
/** The core service returned by `createMasqueradeService`. */
export interface MasqueradeService<Request> {
  /**
   * Start a mode for the authenticated actor.
   *
   * @throws {MasqueradeError} `E_MASQUERADE_INVALID_INPUT`, `E_MASQUERADE_CONTEXT_REQUIRED`,
   *   `E_MASQUERADE_CONTEXT_CHANGED`, `E_MASQUERADE_ALREADY_ACTIVE`, `E_MASQUERADE_NOT_ALLOWED` or
   *   `E_MASQUERADE_UNAVAILABLE`.
   */
  start(request: Request, input: StartInput): Promise<ModeView>
  /**
   * End the actor's mode; an idle actor gets the idle view back.
   *
   * @throws {MasqueradeError} `E_MASQUERADE_INVALID_INPUT`, `E_MASQUERADE_CONTEXT_REQUIRED`,
   *   `E_MASQUERADE_CONTEXT_CHANGED` or `E_MASQUERADE_UNAVAILABLE`.
   */
  stop(request: Request, input: StopInput): Promise<ModeView>
  /**
   * Read the actor's mode without changing it.
   *
   * @throws {MasqueradeError} `E_MASQUERADE_UNAVAILABLE`.
   */
  status(request: Request): Promise<ModeView>
  /**
   * Admit the request once and return its frozen identity. An expired or invalid mode is cleared.
   *
   * @throws {MasqueradeError} `E_MASQUERADE_CONTEXT_CHANGED`, `E_MASQUERADE_NOT_ALLOWED` or
   *   `E_MASQUERADE_UNAVAILABLE`.
   */
  resolve(request: Request): Promise<ResolvedContext>
}
/** Runtime dependencies are ports, never serialisable application configuration. */
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
    error(event: DiagnosticEvent): unknown
  }
  /** Receives errors thrown by observers; they never change a committed result. */
  observerErrorHandler: (error: unknown) => unknown
}
