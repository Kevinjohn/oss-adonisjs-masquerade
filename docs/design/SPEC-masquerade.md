# Technical specification: server-side account masquerade

**Status:** v1 development contract, reduced to the scope accepted in [DEVELOPMENT-PLAN.md](DEVELOPMENT-PLAN.md) on 19 October 2026.
**Version:** 0.3
**Date:** 19 October 2026
**Product requirements:** [PRD-masquerade.md](PRD-masquerade.md)
**Working package label:** `adonisjs-masquerade`; registry name, repository name, version and publication are undecided.

## 1. Reading contract and authority

- This document describes a new, independently maintained package for AdonisJS 7, native Auth 10 and Session 8. Names are proposed APIs. MUST, MUST NOT, SHOULD and MAY carry their usual meaning.
- The PRD's settled boundaries and document-review decisions are requirements. The development plan's twenty agreed items and four owner decisions are the v1 contract; where the plan narrows an earlier proposal, the plan wins.
- Masquerade is an account-level setting: an authenticated operator selects "masquerade as this user" and the server resolves that operator's effective identity on later requests. Start and stop never log in as the target, change the authenticated actor, replace a session or mint target credentials. Native remember-me and cookie maintenance keep their ordinary behaviour.
- This document authorises the milestones in section 11.2. It does not authorise publication, repository naming or merging.
- v1 decisions in one line each: one mode per actor per namespace, visible to all of that actor's sessions (D01); native session transport only, opaque tokens v1.1, JWT out (D02); 15-minute default, 60-minute ceiling, hosts may only narrow (D03); normalised reason, optional by default and host-configurable as required (D04, amended 23 October 2026); one `ControlStore` contract with a Lucid SQLite/PostgreSQL subpath (D05); owner-bound context token on every covered unsafe request with report and enforce modes (D06); one revoked credential never clears the mode, an advanced stamp does (D07); hashed stamps captured at start and rechecked on every active admission (D08); active mode defaults to view-only; edit mode plus `allowMutation()` permits ordinary mutations and `sensitive()` always denies (D09; superseded by [§14](#14-view-only-default-and-per-start-edit-access-accepted-22-october-2026)); an invalidated request never continues as the actor (D10); Account Kit integration is v1.2 (D11).

## 2. Architecture and ownership

- `masquerade-core` owns the state machine, CAS semantics, policy evaluation, expiry, errors and audit contract, and depends on ports only.
- `adonis-integration` owns the provider, request context, effective session guard, controllers, markers, context middleware and commands. `native-authority` owns actor loading, `securityStamp`, `inspectAccount` and incarnation mapping.
- `lucid-control-store` owns atomic persistence, the migration stub, prune and conformance behind the core store contract. The host owns policies, namespace, UI, Bouncer abilities, tenant rules, route markers, limiter and retention.

Proposed exports:

```text
.                 # defineConfig, service, domain types/errors, configure export
./types           # public types only
./providers/masquerade_provider
./auth            # effective guard factory
./http            # context middleware, sensitive()/allowMutation() markers, error mapping, controllers
./native          # native session authority factory
./stores/lucid    # optional SQLite/PostgreSQL store and migration stub
./testing         # memory store and ControlStore conformance suite
```

Lucid is an optional peer, lazily imported from `./stores/lucid`. A packed native-session consumer MUST prove that importing the root resolves neither Lucid nor Account Kit. Peer floors are release claims established by floor/latest consumer runs, not by this document. Repository layout follows this export map plus `tests/`, `examples/native-session/` (the M0 app kept as the consumer fixture) and `docs/`: one responsibility per file, ESM, explicit types at ports, snake_case filenames, narrow exports, no Docker or container-based tests, no AI attribution or private review metadata in source, docs or commits.

### 2.1 Request flow

Session cookie → effective guard authenticates the actor with the raw session guard → read mode row by `(namespace, actorId, incarnation)` → check expiry, hashed stamps, `canMasquerade`, `canUseRequest` → context middleware validates the token on unsafe requests → effective user is the target while active and the actor while idle → Bouncer and application code run as the effective user → handler runs with an immutable actor/effective audit projection.

Control routes (start, stop, status), login, signup, logout and public routes use the raw actor guard. They never read the mode store during authentication. Stop and status read the store inside their handlers and return 503 when it is unavailable. Logout never needs the store.

## 3. Invariants

- **I01:** Every admission has a valid native actor credential from the raw session guard, never from body, query or headers. A stored mode never authenticates a request.
- **I02:** At most one active target per `(namespace, actorId, incarnation)`.
- **I03:** Effective target permissions never include the actor's permissions.
- **I04:** No target session, token or cookie is created, modified or revoked, and transitions add no actor credential refresh, replacement or lifetime extension.
- **I05:** Each committed transition atomically advances the revision, rotates the nonce and writes its audit event in one transaction. A stale expected revision cannot overwrite the current row, including across an idle → active → idle cycle.
- **I06:** Expiry is fixed and UTC-based; `now >= expiresAt` is expired and is checked before business admission.
- **I07:** Policy denial, store failure or validation failure never falls through to running a handler as another identity.
- **I08:** Stop clears the actor's own mode without loading the target or holding permission to start a new one. Status never starts, renews or selects a target.
- **I09:** Observers cannot turn a committed success into a failure or trigger a second transition. Process-local caches and locks are not authoritative.
- **I10:** A request's identity snapshot is immutable after admission; admitted work is not recalled.
- **I11:** Responses, events and observers never receive raw stamps, credentials or whole user records.
- **I12:** While active, `sensitive()` routes and billing mutations cannot be allowed by `allowMutation()`. Superseded by [§14](#14-view-only-default-and-per-start-edit-access-accepted-22-october-2026).

## 4. Identity and policy contracts

```ts
type SubjectId = string // canonical provider ID
type Instant = string // UTC ISO 8601, millisecond precision
type Revision = number // integer 0..Number.MAX_SAFE_INTEGER; 0 is the no-row sentinel
type ContextToken = string // `<revision>.<nonce>`, non-secret

interface Subject<User> {
  id: SubjectId
  incarnation: string
  user: User
}
interface AccountSnapshot<User> {
  subject: Subject<User>
  securityStamp: string
  active: boolean
} // stamp hashed before storage
interface NativeAuthority<User> {
  namespace: string
  guard: string // raw session guard name, e.g. 'web'
  incarnation: 'id' | ((user: User) => string) // required; no silent default
  securityStamp(user: User): string | Promise<string>
  inspectAccount(id: SubjectId): Promise<AccountSnapshot<User> | null>
}
interface MasqueradePolicy<User, Request> {
  canMasquerade(input: {
    actor: Subject<User>
    target: Subject<User>
    reason?: string
    request?: Request
  }): Promise<boolean>
  canUseRequest?(input: {
    actor: Subject<User>
    target: Subject<User>
    request: Request
  }): Promise<boolean>
}
```

- `canMasquerade` is required. It runs at start with `reason` and `request`, and on every active admission without them. Only exact `true` allows. `false` on admission is global invalidation: CAS to idle, one `invalidated` event, 409 context changed. A throw is 503 with mode unchanged.
- `canUseRequest` is optional request-local tenant or route denial. `false` is 403 with mode unchanged; a throw is 503 with mode unchanged. Neither permits actor fallback.
- `inspectAccount` establishes eligibility and the current stamp, never authentication. `null`, `active: false` or a thrown error prevents admission; the public response never discloses target existence.
- Start is deny-by-default: a missing policy fails at boot.

### 4.1 Namespace, identifiers and incarnation

- Namespace is deployment configuration naming one identity domain, not a request-supplied tenant selector. Guards for the same users share a namespace; different identity domains must not.
- `incarnation: 'id'` declares that the host never reuses IDs; otherwise the callback returns a persisted immutable per-account value that does not change on ordinary security updates.
- Resolve target input through the provider, then use the canonical ID. `"001"` and `"1"` are not equated. Bounds: namespace 128 UTF-8 bytes, subject ID 255, incarnation 128, raw stamp 512. Oversized values fail at boot or as invalid input.
- Tenant context is derived after effective identity resolution, never copied from the actor.

### 4.2 Native authority and security stamps

- The host supplies `securityStamp(user)` per subject. A constant, a read-time timestamp or a hash of incomplete fields is not valid.
- The package stores `sha256(stamp)` and compares equality. No sealing, encryption, key provider, rotation or decryption failure paths.
- Both hashes are captured at start and rechecked for actor and target on every active admission. Stop and expiry never read a stamp.
- Logout of one session rejects that credential natively and does not advance the stamp. Logout-all advances the stamp; a later login cannot inherit the prior mode. A server-only `invalidate(actorId)` helper is optional, not a hook system.
- Opaque access-token transport is deferred to v1.1: token guards remain raw actor guards in v1, and a token credential cannot start, use or stop a mode. The v1.1 adapter adds a per-token masquerade ability and the T-TOKEN family.

### 4.3 Effective session guard and Bouncer

The effective guard wraps one declared raw session guard (`web` → `web_effective`) and implements the Auth 10 guard contract. The seam is normative and has no fallback:

1. Business middleware calls `ctx.auth.authenticateUsing(['web_effective'])`. The wrapper's `check()` resolves the effective user, sets its own `authenticationAttempted` and `isAuthenticated`, and returns `true` only after every admission check.
2. Inside the wrapper, actor authentication calls only `ctx.auth.use('web').authenticate()`, never facade `authenticate`, `check`, `authenticateUsing` or `checkUsing`.
3. The default guard for business surfaces is the effective guard. `silent_auth` on a business route must leave the facade on the effective guard.
4. Request Bouncer uses the host's lazy resolver, `new Bouncer(() => ctx.auth.user, ...)`. Policy callbacks receive explicit actor and target models and an explicitly bound Bouncer, never the default instance.
5. Before dispatch, `auth.authenticatedViaGuard` is the effective guard, `auth.user === effectiveGuard.user`, and `auth.use('web').user.id === actorId`. In idle mode the IDs coincide but the effective guard owns the facade.
6. `check()` translates only genuine missing or invalid actor authentication into `false`; domain errors propagate. `driverName` passes through so `E_UNAUTHORIZED_ACCESS` renders as for the session guard, and Japa `loginAs` works unchanged.

M0 proves this in a stock AdonisJS 7 hypermedia starter kit. If facade `auth.user` cannot be made the effective user, M1 does not start. Plain assignment to `ctx.auth.user` or private-field patching is prohibited.

## 5. Service API and request context

### 5.1 Configuration

```ts
interface MasqueradeConfig<User, Request> {
  authority: NativeAuthority<User>
  policy: MasqueradePolicy<User, Request>
  store: () => Promise<ControlStore>
  durationSeconds?: number // default 900; integer 60..maxDurationSeconds
  maxDurationSeconds?: number // default 3600; may only narrow
  contextEnforcement: 'report' | 'enforce'
  retention: { days: number } | 'host-managed'
}
```

Boot fails on unknown fields, non-finite or out-of-range durations, a maximum above 3600, missing policy, missing `incarnation`, unsafe namespace, or the memory store outside tests. There is no allow-all scaffold.

### 5.2 Service and views

```ts
interface StartInput {
  targetId: string | number
  reason?: string
  durationSeconds?: number
  expectedContext: ContextToken
}
interface StopInput {
  expectedContext: ContextToken
}
type ModeView =
  | { isMasquerading: false; contextToken: ContextToken }
  | {
      isMasquerading: true
      contextToken: ContextToken
      targetId: SubjectId
      startedAt: Instant
      expiresAt: Instant
    }
interface MasqueradeService<Request> {
  start(request: Request, input: StartInput): Promise<ModeView>
  stop(request: Request, input: StopInput): Promise<ModeView>
  status(request: Request): Promise<ModeView>
  resolve(request: Request): Promise<ResolvedContext>
}
interface ResolvedContext {
  namespace: string
  actorId: SubjectId
  actorIncarnation: string
  effectiveId: SubjectId
  effectiveIncarnation: string
  isMasquerading: boolean
  contextToken: ContextToken
  modeId?: string // modeId is audit correlation only
}
```

- `ResolvedContext` is the safe projection for business audit, including idle requests. No service accepts an actor ID, revision or mode ID from the client as authority.
- Mode resolution is memoised per request after admission; idle mode loads no target. Request budget: native credential validation, one mode read, stamp and policy reads, and no write unless a transition or invalidation occurs.
- Status returns the target ID only to the authenticated owner. It excludes reason, stamps, raw revision and user objects.

### 5.3 Context token

- Token is `<revision>.<nonce>`. For a row, `nonce` is the stored per-revision random 128-bit value. For an actor with no row, revision is `0` and the nonce is `sha256` of the length-framed tuple `(namespace, actorId, incarnation)`, so it is owner-bound without a key.
- Validation parses the integer revision, compares it to the owner's current revision and compares the nonce for equality. No MAC, key provider or format version. Input is bounded to 128 bytes; malformed input is treated as missing.
- Every covered unsafe request carries the token in the `X-Masquerade-Context` header or the `_masqueradeContext` hidden field. If both are present they must match. Missing is 428; stale is 409.
- `contextEnforcement: 'report'` logs the would-be 428/409 outcome with route and actor ID and lets the request continue. `'enforce'` rejects. Hosts migrate forms in report mode, then flip to enforce before relying on T-CONTEXT.
- Clients MUST NOT refresh the token and replay an old intent. GET/HEAD need no token. Start and stop require the expected token and rotate it on success.
- Idle rows are retained with their latest revision and nonce; pruning never removes them, or pre-start tokens would validate again.

### 5.4 Route classification and markers

- Routes under an effective guard are business routes. GET, HEAD and OPTIONS are `read`; other methods are `mutation`. While active, unsafe methods require edit access and route/group `allowMutation()`; `sensitive()` denies regardless of access or `allowMutation()`. The access rules are superseded by [§14](#14-view-only-default-and-per-start-edit-access-accepted-22-october-2026).
- Markers are explicit route or group middleware; an unsafe verb is at least `mutation` whatever the markers say. Idle requests follow ordinary actor policy and still need the context token.
- Routes under a raw guard are control routes only if they are the package's start, stop and status routes or the host's login, signup, logout and public routes. A raw-guard route that runs business behaviour is a coverage defect.
  **Superseded for Account Kit managed routes only by [§15](#15-v12-account-kit-integration).**
- `node ace masquerade:routes` prints every route grouped by guard with its classification and flags raw-guard routes that are not recognised control routes. The host reviews that report as a release gate (PRD FR-09); it is not a boot gate.
- One Edge share exposes the safe `ModeView` and renders the hidden field. Inertia and API clients read status and send the header.

## 6. Persistence and atomic transitions

### 6.1 Mode table `masquerade_modes`

| Column                                                                               | Constraint                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authority_namespace`, `actor_id`, `actor_incarnation`                               | Unique owner key, bounded strings                                                                                                                     |
| `revision`, `revision_nonce`                                                         | Integer `1..2^53-1` (BIGINT on PostgreSQL, INTEGER on SQLite, parsed and validated on read); random 128-bit hex rotated on every committed transition |
| `state`, `mode_id`, `last_transition_id`                                             | `idle` or `active`; random UUID for the current or most recent mode; UUID generated before the CAS                                                    |
| `target_id`, `target_incarnation`, `actor_stamp_hash`, `target_stamp_hash`, `reason` | Set while active, null while idle; stamps are `sha256` hex                                                                                            |
| `started_at`, `expires_at`, `updated_at`                                             | UTC; active rows require `expires_at > started_at`                                                                                                    |

Malformed rows fail closed. A reused ID with a different incarnation is a different owner key. Idle rows keep only owner key, revision, nonce, `mode_id` and timestamps.

### 6.2 Audit table `masquerade_events`

- Columns: event ID, mode ID when known, namespace, actor ID and incarnation, target ID and incarnation when known, UTC time, kind, outcome code, owner revision, bounded reason for start.
- Kinds: `started`, `stopped`, `expired`, `invalidated`, `start_denied`, `stop_denied`, `control_noop`. Invalidation codes distinguish actor stamp, target stamp, actor ineligible, target ineligible, policy denied and `operator_stopped`; public responses stay generic.
- Operator commands (accepted 23 October 2026): `masquerade:status` lists active modes through `activeBatch` without reasons; `masquerade:stop --actor <id> [--incarnation <value>]` or `--all` (confirmed, or `--force`) re-reads each row and CASes it to idle with one `invalidated` event, outcome `operator_stopped`. Like stop and expiry, it never reads security stamps. A conflict re-reads; `--all` stops when a batch makes no progress.
- Never persist credentials, cookies, stamps, user objects, request bodies, IP addresses or user agents.
- Committed transitions write the row update and the event in one transaction. After native authentication, CSRF and the host limiter, each start or stop is inside the control-audit boundary: its denial, input failure, context conflict or idle-stop no-op is written through `recordControlOutcome` without changing revision. A failed outcome write is 503 with no state change.
- Native authentication failures, limiter rejections, status denials and business or local denials use host diagnostics, not package events.
- Rate limiting is the host's `@adonisjs/limiter` on the mounted routes, with separate start and stop budgets so an exhausted start budget cannot block recovery. The package ships documentation, not limiter code.
- After commit, the service emits `masquerade:started|stopped|expired|invalidated` through the Adonis emitter and logs through the logger without awaiting. Rejections are caught and routed to the emitter error handler. No deadline, slot cap, abort signal or config hooks. This satisfies PRD FR-30 by never awaiting; delivery is best effort with event IDs for deduplication.

### 6.3 Store contract

```ts
interface OwnerKey {
  namespace: string
  actorId: SubjectId
  actorIncarnation: string
}

type CasOutcome =
  | { status: 'applied'; transitionId: string }
  | { status: 'conflict' }
  | { status: 'indeterminate'; transitionId: string }

interface ControlStore {
  read(owner: OwnerKey): Promise<ModeRow | null>
  // expected=null means INSERT IF ABSENT. Row update and event commit together or not at all.
  compareAndSet(input: {
    owner: OwnerKey
    expected: Revision | null
    next: ModeRow
    event: AuditEvent
  }): Promise<CasOutcome>
  recordControlOutcome(event: AuditEvent): Promise<void>
  expiredBatch(input: { now: Instant; limit: number }): Promise<ModeRow[]>
  // At most limit active snapshots, oldest update first; operator commands re-read and use CAS.
  activeBatch(input: { limit: number }): Promise<ModeRow[]>
  pruneEvents(input: { before: Instant; limit: number }): Promise<number>
}
```

- PostgreSQL uses unique insert or conditional update with the event insert in the same transaction. SQLite uses real transactions with bounded busy handling. Process-local mutexes do not satisfy the contract; read-then-unconditional-write is prohibited.
- The transition UUID is generated before the CAS and retained across the adapter's safe retries. A definite pre-commit failure throws unavailable. A lost commit acknowledgement returns `indeterminate`; the service logs the transition ID server-side and returns 503 `E_MASQUERADE_UNAVAILABLE`. GET status is the recovery path. No automatic retry, compensation or speculative observer emission.
- The conformance suite under `./testing` runs against memory, SQLite and PostgreSQL and is the contract for custom stores.

### 6.4 State transition table

| Current state | Input / condition                                                              | Result                                                                                |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Absent/idle   | Valid start, matching context, eligible actor and target, `canMasquerade` true | Active; new mode ID, revision and nonce; fixed expiry; one `started` event            |
| Active        | Any second start, including same target                                        | 409 `E_MASQUERADE_ALREADY_ACTIVE`; no replacement or extension; `start_denied` record |
| Active        | Valid stop with matching context                                               | Idle; next revision and nonce; clear stamps, target, reason; one `stopped` event      |
| Idle/absent   | Stop with current context                                                      | 200 idle; no revision change; one `control_noop` record                               |
| Any           | Mismatching expected context on start or stop                                  | 409 `E_MASQUERADE_CONTEXT_CHANGED`; current winner untouched; denial record           |
| Active        | Expired, stamp changed, account ineligible or `canMasquerade` false            | CAS to idle; one `expired` or `invalidated` event; triggering business request 409    |
| Active        | Actor credential invalid, or `canUseRequest` false                             | Reject that request (401 or 403); mode unchanged                                      |
| Any           | Store unavailable, malformed row, policy or authority throw                    | 503; no handler, no actor fallback                                                    |
| Any           | Revision at `Number.MAX_SAFE_INTEGER`                                          | Fail closed; controlled migration required; never wrap                                |

## 7. Algorithms

### 7.1 Start

1. Authenticate the raw actor guard; Shield CSRF and the host limiter have already run. Validate input shape and the expected context against the current row. Resolve an expired active row to idle first, then return 409; never start from an old token in the same request.
2. Reject an active mode and self-targeting. Resolve the target through `inspectAccount` with generic denial for missing or ineligible targets.
3. Apply the configured reason policy: in `'optional'` (default) an absent or blank reason becomes `null` on the row and is omitted from the event; in `'required'` it is invalid input. Evaluate `canMasquerade` with request and any supplied reason, then `canUseRequest` when configured. Capture both stamp hashes and the fixed deadline from the injectable clock.
4. CAS the active row and `started` event against the observed idle revision, or insert if absent. Only the winner succeeds. Return the committed view with the new token, then emit without awaiting. No login, logout or cookie change occurs.

### 7.2 Business request admission

1. Authenticate the raw actor guard inside the effective guard, then read the owner row. No cross-request allow cache.
2. If idle, the effective user is the actor; the context middleware still validates unsafe requests and no active-mode restrictions apply.
3. If active, check expiry, both stamp hashes, both accounts' eligibility and `canMasquerade`. Any global invalidity CASes to idle and returns 409; a CAS conflict is re-read, never treated as permission. Then `canUseRequest` when configured: `false` is 403, a throw is 503, mode unchanged.
4. Validate the context token on unsafe requests under the configured enforcement mode.
5. While active, apply §14 request-action rules after token validation; then ordinary Bouncer checks run as the target. This step is superseded by [§14](#14-view-only-default-and-per-start-edit-access-accepted-22-october-2026).
6. Freeze the actor/effective snapshot and return the effective user through the guard.

### 7.3 Stop, expiry and logout

- Stop authenticates the raw actor guard and does not load the target or evaluate `canMasquerade` or `canUseRequest`. It reads the owner row, verifies the expected context (a stale stop never clears a newer mode), then CASes to idle with one `stopped` event. Repeated stop with the current idle token records `control_noop` and returns idle.
- Stop works after target deletion, suspension, stamp change or loss of start permission, provided the actor credential is valid.
- Every admission enforces expiry; the prune command is housekeeping, not the mechanism. Cleanup re-reads and never clears a newer mode.
- Clock is injectable for tests; deployments need synchronised clocks. A durably ended mode never reactivates on backward clock movement.
- Logout of one session ends that credential only. Logout-all advances the stamp. A fresh login during a valid mode sees the target; documentation states this.
- Self-targeting is invalid input. Switching target requires stop, fresh context, then start.

## 8. HTTP contract

| Method/path              | Operation | Input                                                         | Success               |
| ------------------------ | --------- | ------------------------------------------------------------- | --------------------- |
| `GET /masquerade`        | Status    | Raw actor credential                                          | 200 `ModeView`        |
| `POST /masquerade/start` | Start     | `{ targetId, reason?, durationSeconds?, access? }` plus token | 200 active `ModeView` |
| `POST /masquerade/stop`  | Stop      | `{}` plus token                                               | 200 idle `ModeView`   |

- Routes are opt-in and mounted by the host under a prefix behind Shield CSRF and the host limiter. Server-rendered controllers may redirect to fixed same-origin paths.
- Control, status and effective-user responses send `Cache-Control: no-store` and appropriate `Vary`.
- Input: reject unknown fields, oversized bodies (8 KiB), fractional or out-of-range durations, and client-supplied expiry. The optional `access` field is specified in §14; this start-body clause is superseded by [§14](#14-view-only-default-and-per-start-edit-access-accepted-22-october-2026).
- Reason normalisation order (for a supplied reason, or any reason in required mode): trim with `String.prototype.trim()`, replace `\r\n` with `\n`, reject any C0 or C1 control except `\n` and `\t`, then require 1–500 Unicode code points and at most 2,000 UTF-8 bytes. Persist the normalised value; never truncate. Acceptable: `Ticket 4821: cannot see invoices`. Unacceptable: a tab-only string, or text containing `\u0007`.
- JSON errors are `{ errors: [{ code, message }] }` with stable codes and English messages, except §14 defines the `blockedBy` field for `E_MASQUERADE_ACTION_BLOCKED`. The host exception handler localises; the package ships no translations, i18n lookup or JSON:API negotiation.

| HTTP | Code                            | Meaning                                                                           |
| ---- | ------------------------------- | --------------------------------------------------------------------------------- |
| 401  | `E_MASQUERADE_UNAUTHENTICATED`  | Actor credential or account access invalid                                        |
| 403  | `E_MASQUERADE_NOT_ALLOWED`      | Policy or eligibility denial; no target disclosure                                |
| 403  | `E_MASQUERADE_ACTION_BLOCKED`   | Sensitive route or mutation denied while active; §14 supplies `blockedBy`         |
| 409  | `E_MASQUERADE_ALREADY_ACTIVE`   | Cannot nest, replace or renew                                                     |
| 409  | `E_MASQUERADE_CONTEXT_CHANGED`  | Stale token, concurrent transition, expiry or invalidation; no handler ran        |
| 422  | `E_MASQUERADE_INVALID_INPUT`    | Invalid control input or self-target                                              |
| 428  | `E_MASQUERADE_CONTEXT_REQUIRED` | Covered unsafe request lacks a token                                              |
| 503  | `E_MASQUERADE_UNAVAILABLE`      | Store, authority or policy infrastructure failure, or lost commit acknowledgement |

Limiter rejections are the host limiter's own 429. Shield CSRF errors remain framework errors. No `Idempotency-Key` header is advertised; CAS plus status defines retry behaviour.

## 9. Account Kit integration (deferred to v1.2)

The Account Kit adapter, the proposed public account-access inspection operation and managed-route blocking are not part of v1. Core keeps the native authority contract in section 4 as the only contract: `securityStamp` and `inspectAccount` callbacks. v1.2 implements that contract on top of Account Kit's existing actor credential checks, where the inspection read must return a coherent `{account, revision}` snapshot under Account Kit's account lock or an equivalent, and the adapter performs the comparison. The inspection API lands in the Account Kit repository first, with its own API review.

Until then, hosts using Account Kit may wire the native contract by hand against Account Kit's public API, but no test family (T-KIT, T-KIT-HTTP) or packed consumer claims that integration in v1. Account Kit MUST NOT depend on this package; core MUST NOT import Account Kit. Nothing in v1 adds an Account Kit column, flag or route. **Superseded for the accepted v1.2 scope by [§15](#15-v12-account-kit-integration).**

## 10. Operational limits and retention

- Each threat maps to one test family in section 11.1: privilege escalation to T-AUTH and T-IDENTITY, stale or cross-account intent to T-CONTEXT, races to T-CONCURRENCY, renewal to T-EXPIRY, outage fallback to T-FAILURE, listener failure to T-AUDIT, data leakage to T-PRIVACY, hidden mutations to T-ACTIONS, tenant crossing to T-TENANT.
- Background workers, jobs, WebSocket messages and external calls do not inherit a safe effective context. Jobs created under a mode must carry the `ResolvedContext` projection and the host's own authorisation.
- Already admitted requests finish; a stop cannot retract their effects. Transaction-time guards for irreversible operations are the host's responsibility. Shared automation credentials should use a distinct namespace or subject so operator modes never apply to them.
- `retention: { days: n }` makes `masquerade:prune --batch-size=100` expire active rows by conditional update, then delete events older than `n` days. `'host-managed'` prunes expiry only and leaves events to the host.
- Pruning rechecks revision and expiry per row so a stale batch cannot clear a newer mode. Idle rows are never pruned.
- Owner erasure for account deletion is a documented SQL recipe: delete the retired incarnation's row and apply the host's event policy. No erasure API ships.
- Diagnostics for store or authority outages, denied transitions and invalid configuration are logged without reasons or user IDs in metric labels.

## 11. Verification

### 11.1 Test families

| Family             | Required cases                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T-AUTH**         | Missing, false and throwing `canMasquerade`; non-operator caller; self-target; missing and ineligible target indistinguishable; stop allowed after start permission removed; no client actor substitution.                                                                                                                                                                                               |
| **T-IDENTITY**     | In the M0 app: facade `auth.user`, `getUserOrFail()` and `authenticatedViaGuard` are the effective guard before, during and after a mode; raw `web` guard still reports the actor; lazy Bouncer resolves the target; `silent_auth` on a business route keeps the facade effective; `driverName` passthrough renders `E_UNAUTHORIZED_ACCESS`; Japa `loginAs` works; two simultaneous actors are isolated. |
| **T-CREDENTIALS**  | Start, stop, status and effective requests compared with native-authentication controls for existing sessions, remember-me recovery and expired sessions; no login, logout, cookie rotation or session issuance by mode code.                                                                                                                                                                            |
| **T-CONTEXT**      | Idle token rejected after start; active token rejected after stop; A → idle → A invalidates the old token; missing is 428, stale is 409; wrong owner, wrong namespace and malformed tokens fail; header/field conflict fails; form rendered as A then submitted as B fails; report mode logs and admits, enforce rejects; no-row deterministic token differs per actor.                                  |
| **T-CONCURRENCY**  | Two starts at the same idle revision on independent connections yield one winner and one event; simultaneous stop/start; stale stop; separate devices share one mode; stale expiry batch cannot clear a new selection.                                                                                                                                                                                   |
| **T-EXPIRY**       | Exact deadline with injectable clock; non-sliding reads; minimum, maximum and invalid durations; host narrowing; backward clock; delayed prune; expiry concurrent with stop or start; no handler on the triggering request.                                                                                                                                                                              |
| **T-INVALIDATION** | Actor or target deleted, suspended or stamp changed; `canMasquerade` false on admission; `canUseRequest` false leaves mode; throws return 503 without clearing; target deletion does not block stop.                                                                                                                                                                                                     |
| **T-ACTIONS**      | Active unsafe denied by default; `allowMutation()` permits under target Bouncer; `sensitive()` and billing denied regardless; idle routes follow actor policy with token; unsafe verb cannot be marked read; `masquerade:routes` flags unmarked raw-guard routes; logout affects the actor credential only.                                                                                              |
| **T-FAILURE**      | Store read, write and event failure; unique conflict; SQLite busy timeout and rollback; lost commit acknowledgement maps to 503 with the transition ID logged; authority and policy throws; stop and status 503 when store unavailable while login and logout succeed.                                                                                                                                   |
| **T-AUDIT**        | Row and event atomicity; admitted denials, conflicts and no-ops recorded without revision change; outcome write failure is 503; pre-boundary rejections write nothing; events carry both incarnations; rejected listener leaves the committed result and reaches the emitter error handler.                                                                                                              |
| **T-PRIVACY**      | No stamps, raw models or reasons in status, errors, logs or events; no target enumeration; reason normalisation order with one acceptable and one unacceptable example; code-point and byte boundaries; body size; `no-store` headers; reused ID with new incarnation rejects old mode and token.                                                                                                        |
| **T-STORE**        | Conformance suite on memory, SQLite and PostgreSQL; two-connection PostgreSQL race; SQLite independent-connection CAS and audit under busy timeout and rollback; owner isolation; idle row retention; malformed state; BIGINT string parsed to integer; one `MAX_SAFE_INTEGER` overflow test.                                                                                                            |
| **T-PACKAGE**      | Packed native-session consumer at floor and latest dependency sets on SQLite and PostgreSQL; root import resolves neither Lucid nor Account Kit; `configure` command; numeric, string and UUID IDs; alternate users table.                                                                                                                                                                               |
| **T-TENANT**       | Distinct namespaces never collide; actor across included guards shares one mode; cross-tenant denial; device in tenant B denied locally while tenant A mode and revision stay unchanged; tenant context not inherited from the actor.                                                                                                                                                                    |

Deferred families: T-TOKEN (v1.1), T-KIT and T-KIT-HTTP (v1.2). PRD traceability: AC-01 and AC-05 to T-AUTH, T-STORE, T-CONCURRENCY, T-CREDENTIALS; AC-02 and AC-03 to T-IDENTITY, T-TENANT, T-AUDIT; AC-04 to T-AUTH, T-FAILURE; AC-06 to AC-08 to T-AUTH, T-INVALIDATION, T-CREDENTIALS; AC-09 and AC-10 to T-INVALIDATION, T-EXPIRY, T-CONTEXT, T-ACTIONS, T-TENANT; AC-11 and AC-12 to T-CONTEXT, T-ACTIONS; AC-13 and AC-14 to T-AUDIT, T-PRIVACY, T-FAILURE, T-STORE; AC-15 and AC-16 to T-PACKAGE and documentation review.

FR-24 and FR-25 are satisfied in v1 only to the extent of the native-session transport; their adapter clauses are deferred per the PRD v1 scope addendum. M4 produces a requirement-to-test ledger for every retained FR, NFR and AC; a family label alone is not evidence.

### 11.2 Milestone acceptance gates

| #   | Ships                                                                                                                                                                                                                    | Gate                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| M0  | Throwaway AdonisJS 7 hypermedia starter-kit app with the effective guard over the session guard.                                                                                                                         | T-IDENTITY passes in the real app. This document is the SPEC per plan item 17.                       |
| M1  | Core: state machine, CAS on the memory store, policy, fixed expiry with injectable clock, nonce token, hashed stamps, reason rule, emitter events.                                                                       | Every row of section 6.4 has a mutation-checked test.                                                |
| M2  | Lucid store: migration stub, CAS plus event in one transaction, conformance suite on SQLite and PostgreSQL, prune command.                                                                                               | Two-connection PostgreSQL race yields one winner and one event; SQLite busy and rollback cases pass. |
| M3  | HTTP: controllers, effective session guard, markers, context middleware with report/enforce, Edge share, error codes, `no-store`, `masquerade:routes`.                                                                   | T-CONTEXT and T-ACTIONS pass in the M0 app.                                                          |
| M4  | `configure` command, docs (account-global scope, one-device logout, cross-device behaviour, Inertia/fetch header, jobs and side effects, report-to-enforce migration), packed consumer at floor and latest. Publish 0.x. | Requirement-to-test ledger complete.                                                                 |

Commands are future repository scripts on Node 24 with pnpm: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm quick:test`, `pnpm test:pg`, `pnpm test:consumer`. Each is run exactly as the repository script, never the bare tool.

## 12. References

- [AdonisJS session guard](https://docs.adonisjs.com/guides/auth/session-guard), [custom guards](https://docs.adonisjs.com/guides/auth/custom-auth-guard) and [authorization](https://docs.adonisjs.com/guides/auth/authorization): integration contracts to verify in M0.
- [Auth 10 Authenticator](https://github.com/adonisjs/auth/blob/10.x/src/authenticator.ts) and [session guard](https://github.com/adonisjs/auth/blob/10.x/modules/session_guard/guard.ts): the seam in section 4.3 depends on their last-attempted-guard behaviour, which M0 proves rather than assumes.
- [Previously assessed package](https://github.com/devnymous/adonis-impersonate/tree/b86b3c82dcff91026473d861999a6afba9c42314): comparison only; its browser-login-switch architecture is not adopted.

This document defines acceptance targets, not execution results. The original milestone gates
are recorded as complete in [M4-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M4-RESULT.md) and the
[requirement ledger](../maintainers/requirement-ledger.md). Those records distinguish verified
behavior from publication; the technical contract remains authoritative for implementation.

## 13. V1.1 additive contract: opaque access tokens

This section adds the v1.1 access-token transport to the completed v1 contract. Sections 1–12 and
the accepted [development plan](DEVELOPMENT-PLAN.md) remain the historical v1 record; the v1.1
transport does not change v1 session behavior or expand the accepted v1 scope. AdonisJS Auth 10
opaque access tokens are supported. JWT remains out of scope, and Account Kit remains v1.2.

### 13.1 Native adapter and composition

The public APIs are exported from `adonisjs-masquerade/native`:

```ts
const tokens = accessTokensAuthority({
  authority: session.authority,
  guard: 'api',
  provider: tokenProvider,
  ability: 'masquerade',
})

const nativeAdapter = nativeAuthorities(session, [tokens])
```

`accessTokensAuthority` accepts an Auth 10 `AccessTokensUserProviderContract`, the raw token guard,
and a required nonempty ability name. With a shared authority, the only authority option is
`authority`; standalone token-only applications instead provide `namespace`, `incarnation`,
`securityStamp`, and `isActive`. These option sets are mutually exclusive. The standalone adapter
uses its token provider for account lookup and inspection.

`nativeAuthorities(primary, additional)` keeps the exact `primary.authority` object and returns a
frozen record of native adapters keyed by raw guard. Every additional adapter must reference that
same authority object, and raw guard names must be unique. The configured package authority remains
the primary authority. Bind the composed adapter in the application container as `masquerade.native`.

`effectiveAccessTokensGuard(rawGuard, { guard: 'api' })` wraps the named raw token guard as an
effective-user facade. Its effective `User` type does not promise `currentAccessToken`. The raw
selected guard retains the authenticated actor and native access token.

### 13.2 Authentication and route selection

The adapter authenticates only through the named native access-token guard, preserving its
missing, malformed, expired, and revoked credential behavior. It checks the native token's
`allows(ability)` method before canonical provider identity mapping or any package mode read.
Capability denial returns 403 and performs no store read, audit event, or state mutation. Auth 10
wildcard `'*'` tokens satisfy `allows()` and therefore satisfy the configured Masquerade ability;
hosts MUST issue restricted abilities deliberately when least privilege is intended.

One explicit route selection determines the raw credential adapter for effective middleware, runtime
admission, and `silent_auth`. The package never sniffs bearer headers or falls back between
credentials. Same-raw aliases are valid; different effective transports, or a raw and effective
choice together, are ambiguous and fail closed. A route listing only raw guards with different
credentials selects no adapter: native authentication and `silent_auth` keep their v1 behavior, and
any Masquerade operation on it returns unavailable before store access. A request with both cookie
and bearer credentials uses only the route-selected guard. A route guard is unknown when it is
absent from the host's registered Auth guard factories. Such a selection fails closed. A registered
raw Auth guard without a Masquerade adapter can still serve a native authentication, security, or
logout route that does not invoke Masquerade. If that route invokes the Masquerade service, it
returns unavailable before any store access; it MUST NOT fall back to the primary adapter. Effective
guard factories MUST map to registered adapters at boot. Token-only mode defaults to its effective
token facade. Public and direct service calls without route selection use the primary adapter.

Raw authentication, security, logout, and public routes keep native behavior. Raw control-route
authentication itself is store-free; when a raw token route invokes a Masquerade operation, the
configured ability is still required before mode access. Raw token business routes remain route
coverage defects and are not a workaround for missing ability. Integrated token business, status,
start, and stop operations all require the one configured ability, even while idle. This ability is
distinct from `canMasquerade`: host start and active-admission policy remain as in v1, and stop does
not read start policy, actor or target stamps, or target account data.

**Superseded for Account Kit managed routes only by [§15](#15-v12-account-kit-integration).**

### 13.3 Account mode, context, and credential boundaries

For an account shared across session and token transports, both adapters use the exact same
authority object, namespace, canonical provider identity, incarnation, stamp, and eligibility
semantics. They read and control the same owner row and revision. Session-started mode is visible
to an authorized token; token-started mode is visible to an authorized session. Context tokens
remain owner-bound and unchanged across transports. Existing missing/stale behavior remains 428/409,
and clients MUST NOT refresh a context token and replay the old intent.

The route declaration selects identity; conflicting or invalid incidental credentials cannot cause
transport fallback. `silent_auth` on an effective token business route authenticates through the
selected token adapter and leaves the effective facade in place. A token with insufficient ability
cannot read or change mode, and an active mode never falls back to actor business behavior.

The target is never issued or attached a token. The effective target user does not inherit the
actor's `currentAccessToken`; the actor token remains on the raw guard. Native Auth 10 continues to
own token issuance, expiry, `last_used_at`, and revocation. Revoking one token rejects that
credential but leaves account mode intact for other valid credentials. A shared security-stamp
change invalidates the mode for subsequent admission across transports. No Masquerade path issues,
rotates, or extends a native credential.

Bearer-only routes may use explicit Shield CSRF exemptions. Session CSRF configuration is
unchanged, and context-token validation remains in force for both transports.

### 13.4 T-TOKEN acceptance family

T-TOKEN requires evidence for both token-only and mixed session/token integration. It covers:

- A real native opaque token with the configured ability can read idle status, start, read the
  target through effective business routes, pass allowed Bouncer checks, deny sensitive actions,
  and stop. The facade exposes the effective `User`; the raw guard retains the actor and unchanged
  `currentAccessToken`.
- Tokens without the ability, malformed credentials, unknown users, expired credentials, and
  revoked credentials cannot access integrated behavior. Native invalid-credential responses are
  preserved. Ability denial happens before store read, audit, or mutation. Wildcard ability is
  verified and documented.
- A session and token for one account start, observe, and stop the same mode in both directions.
  Revoking one credential does not clear it for another. A changed shared stamp invalidates the
  mode. Context ownership, stale context, stop despite denied policy or failed stamps/target reads,
  and a session/token CAS race are covered.
- Conflicting cookie and bearer actors, invalid incidental credentials, token-only boot and
  journey, same-raw aliases, unknown/duplicate adapters, ambiguous routes, selected-token
  `silent_auth`, and no package reads on ability denial are covered. Wrong driver/config fails
  closed before mode access.
- No target token or credential mutation occurs; token provider reads and native `last_used_at`
  behavior remain Auth-owned. Effective target typing and projections do not expose the actor token.
- Missing context is 428 and stale context is 409 without handler execution or context refresh and
  replay. Explicit bearer-only Shield exemptions leave session CSRF behavior intact. Raw
  authentication, security, and logout routes remain native and store-free; raw business routes are
  reported as coverage defects.

This family defines required acceptance evidence; it does not claim that a test or packed-consumer
matrix has passed. Current evidence and any remaining gaps belong in the
[requirement ledger](../maintainers/requirement-ledger.md).

**Superseded for Account Kit managed routes only by [§15](#15-v12-account-kit-integration).**

## 14. View-only default and per-start edit access (accepted 22 October 2026)

This additive contract changes D09/I12 and the related route, admission and start rules above. The owner accepted D1–D10 on 22 October 2026.

### 14.1 Access contract and policy

- Access values are exactly `'view' | 'edit'`. Every new mode defaults to `'view'`; there is no configuration-level default. Access is fixed for the lifetime of a mode.
- `StartInput.access?: 'view' | 'edit'`. Only `undefined` defaults to `'view'`; supplied values other than exactly `'view'` or `'edit'` are invalid input. `ModeView` exposes `access` exactly while active. Idle views omit the key.
- `ResolvedContext.access?` is present exactly while masquerading, like `modeId`. The account-wide mode applies the selected access to every integrated session and token transport; there is no per-token edit ability.
- Add optional `canEdit(input: { actor: Subject<User>; target: Subject<User>; reason?: string; request?: Request }): boolean | Promise<boolean>` to `MasqueradePolicy`. A missing callback or any result other than exact `true` denies edit. A throw is an infrastructure failure. `canMasquerade` keeps its existing input and meaning and MUST NOT receive access as an authorization shortcut.
- At start with `access: 'edit'`, call `canEdit` only after `canMasquerade` returns `true` and before `canUseRequest`. A missing callback or non-`true` result returns 403 `E_MASQUERADE_NOT_ALLOWED` and leaves mode unchanged. A throw returns 503 and leaves mode unchanged; record the existing `policy` / `can_edit` diagnostic. View starts never call `canEdit`.
- At admission of an active edit-mode row, call `canMasquerade` first and then `canEdit({ actor, target })`, without reason or request. If `canEdit` is absent or does not return exact `true`, invalidate the whole mode with code `edit_denied`; reject the triggering request with 409. Do not downgrade. A throw returns 503 with mode unchanged. View-mode admission never calls `canEdit`. Stop never calls either edit or masquerade policy.

### 14.2 Persistence and audit projection

- `masquerade_modes.access` is nullable `string(8)`: `view` or `edit` for active rows and `NULL` for idle rows. Validation rejects every other persisted value. The existing create migration is edited in place; no upgrade migration is added.
- `masquerade_events.access` is nullable `string(8)`. Every event written from an active row, including the `started` event, carries that row's access; events without an active row omit the field and persist `NULL`. `AuditEvent` and `ObserverEvent` expose optional `access`. `validateTransition` requires `event.access === projected?.access`.
- The mode transition and audit write remain atomic. No package event or diagnostic is added for blocked business requests; `blockedBy` is available to host diagnostics.

### 14.3 Active request action rules

After active admission and context-token validation, apply these rules in order:

| Condition                                          | Result                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| Route is `sensitive()` (any method)                | 403 `E_MASQUERADE_ACTION_BLOCKED`, `blockedBy: 'sensitive'`            |
| Method is unsafe and `access !== 'edit'`           | 403 `E_MASQUERADE_ACTION_BLOCKED`, `blockedBy: 'view_only'`            |
| Method is unsafe and route lacks `allowMutation()` | 403 `E_MASQUERADE_ACTION_BLOCKED`, `blockedBy: 'mutation_not_allowed'` |
| Otherwise                                          | Continue; ordinary Bouncer authorization runs as the target            |

The view-only check MUST use `access !== 'edit'`, so a missing or unknown access value fails closed. In view mode, an unsafe route without `allowMutation()` still returns `blockedBy: 'view_only'`; it MUST NOT reveal route configuration. `sensitive()` always takes precedence. Safe methods continue under ordinary target authorization; this is not a guarantee that handlers have no side effects.

### 14.4 Error contract and JSON

- Export `MasqueradeBlockedBy = 'sensitive' | 'view_only' | 'mutation_not_allowed'` from the package root.
- `new MasqueradeError('E_MASQUERADE_ACTION_BLOCKED', { blockedBy })` requires `blockedBy`. `new MasqueradeError(code)` remains the constructor form for every other code and takes no second argument.
- For `E_MASQUERADE_ACTION_BLOCKED`, `handle()` emits `{ errors: [{ code, message, blockedBy }] }`. Other errors remain `{ errors: [{ code, message }] }`. Messages remain stable English strings; the host localises.

### 14.5 Transition and test obligations

Add transition rows: a denied edit start leaves the current mode unchanged; failed edit admission invalidates the edit mode with `edit_denied` and rejects that request with 409. Existing view admission and stop behavior are unchanged.

Add cases to these test families: T-AUTH (edit policy absent, false/non-true, throw, call order and arguments); T-INVALIDATION (`edit_denied`, no downgrade, triggering request rejected); T-ACTIONS (request-rule order, all `blockedBy` values, unknown/missing access fail-closed); T-AUDIT (active-row access projection for service and prune producers); T-STORE (nullable columns and access equality validation); T-TOKEN (shared account mode/access across supported transports).

## 15. V1.2 Account Kit integration

This section records the v1.2 Account Kit contract accepted by the owner in issue #94 on 22
October 2026. It supersedes only the specifically identified v1/v1.1 rules below; all other requirements remain in force. The Account Kit package
name and alpha version remain release-time values until the alpha is published. The v1.2 subpath is
optional, and the core package must remain usable without resolving Account Kit.

### 15.1 Package and authority boundary

- Export the adapter from `adonisjs-masquerade/account-kit` and its provider from
  `adonisjs-masquerade/account-kit/provider`. Declare the Account Kit alpha as an optional peer
  dependency pinned to its released alpha version. Do not create a separate package.
- Adapter construction accepts the host namespace, incarnation, lazy `kit` resolver, framework
  provider and Account Kit `managedGuard`; the access-token strategy also supplies its required
  ability. Resolve Account Kit lazily. The raw guard name comes from `managedGuard.name`. The host
  does not supply `securityStamp` or `isActive` callbacks; Account Kit provides these semantics.
- The adapter returns the native authority and actor-authentication contract. Core MUST NOT import
  Account Kit, and Account Kit MUST NOT depend on Masquerade. Do not add Account Kit persistence,
  migrations, or public core APIs.
- v1.2 supports one Masquerade transport, matching the Account Kit instance's configured
  `session` or `access_tokens` strategy. A second transport composed alongside it is unsupported.
  SQLite and PostgreSQL are supported; MySQL is not claimed.

### 15.2 Account inspection and stamp

For actor and target inspection, call
`kit.authentication.inspectAccountAccess({ userId, requireActive: true })`. Map
`AccountAccessDeniedError` to ineligible (`null`), using its code as a fallback when needed; let
other errors propagate so the core fails closed with 503. This inspection is not authentication,
does not issue credentials, and does not evaluate Account Kit admission.

Encode a null revision as `account-kit:null` and any other revision as
`account-kit:revision:<revision>`; compare stamps only by equality. Use the coherent account and
revision snapshot returned by inspection. Load the framework user by the snapshot's canonical
account ID; a missing user is ineligible, while a mismatched canonical ID is an operational error.
The adapter associates each returned user object with its captured stamp and rejects stamp reads
for objects it did not inspect.

### 15.3 Actor authentication and admission

Authenticate through the named native raw guard. For the `access_tokens` strategy, require its
configured per-token ability. Then call `managedGuard.current(ctx)` and
`kit.authentication.current(input)`. Account Kit rejection maps to native 401; other operational
errors map to 503. There is no actor fallback. Account Kit's current check retains its normal
session-touch behavior.

Account admission remains a separate host gate. Obtain `AccountAdmission` from
`adonisjs-account-kit/admission`; its provider is `adonisjs-account-kit/admission/provider`.
The provider supplies the DI binding; import `admissionMiddleware` separately from
`adonisjs-account-kit/admission`. On host-selected Masquerade control and business routes, register
`admissionMiddleware({ admission: async () => app.container.make(AccountAdmission), guard: managedGuard })`
before `masqueradeContext`. The middleware calls the admission service's `.require`. The context
middleware can read mode and admit business requests, so a route-level admission middleware placed
after it is too late. A revoked actor is denied with
Account Kit's 403 before the mode row is read or changed; the mode can resume after re-approval if
no other invalidation occurred. Hosts that need revocation to end a mode use `changeRestriction`.
For target policy, resolve `const admission = await app.container.make(AccountAdmission)` and call
`await admission.isAdmitted(target.id)` inside `canMasquerade`. Target admission is therefore
re-evaluated on each active admission and denial follows the existing `policy_denied` behavior.
`canAccess` remains Account Kit's restriction check and is not extended to include admission.

### 15.4 Managed-route blocker

The host installs the adapter global router middleware after session and `initialize_auth`
middleware, in `start/kernel.ts`. It identifies managed requests by route name beginning `accountKit.`. While a mode is
active, it blocks every such route except `accountKit.account.logout` and
`accountKit.auth.csrf`, returning `E_MASQUERADE_ACTION_BLOCKED` with `blockedBy: 'sensitive'` before
the handler. This applies to each HTTP method and to custom prefixes or excluded endpoints.

Non-Account-Kit routes pass without a store read. The two exemptions pass without a store read.
Other managed requests whose raw guard does not authenticate pass without a store read, preserving
unauthenticated public proof flows. An authenticated actor's request reads the existing owner row through a new
symbol-keyed internal service method re-exported through the runtime, using the service's
validation, canonical owner key and clock. It opens no second store, does not call Account Kit
`current`, and does not clear or extend mode. Active and unexpired mode is blocked; absent, idle or
expired mode passes; store failure returns 503. A token lacking the Masquerade ability is still
subject to this blocker when the raw guard authenticates it.

The provider's `ready` hook checks `kit.managedHttp.assertGuard(managedGuard)`, verifies that every
mounted `accountKit.*` route corresponds to a `managedRouteRegistration` entry, and records that the
blocker is installed for the route report. A failed check fails startup. The HTTP lifecycle runs
`ready` after the router commits. The console lifecycle used by `masquerade:routes` runs `ready`
before command execution and before router commit, so when `app.getEnvironment()` is `console` and
the router is not yet committed the provider calls `router.commit()` itself, then performs the same
registration and middleware checks. The provider never commits in any other environment: the test
lifecycle also runs `ready` before the host's tests start the HTTP server, and a commit there would
drop routes a test registers later. The lifecycle behavior has focused
regression coverage in `tests/account_kit_lifecycle.spec.ts`. Keep the first-request fallback only
for a future lifecycle change that makes this commit-and-check sequence unavailable.

`masquerade:routes` recognizes names beginning `accountKit.` from `router.toJSON()` without
importing Account Kit. It groups these as “Account Kit managed (blocked while active)” only when
the provider recorded successful blocker installation. Otherwise it reports them as `UNCLASSIFIED`
with a missing or unverified blocker note. Hosts without Account Kit must still be able to run
`node ace`.

### 15.5 Acceptance and supersession

T-KIT covers stamp encoding and snapshot capture; actor and target eligibility; operational
inspection failures; actor/target stamp invalidation; credential-specific actor rejection; host
admission behavior; both supported strategies, session management on/off, incarnation callbacks;
and provider guard validation. T-KIT-HTTP covers blocking every mounted managed route before its
handler, exemptions and store-free cases, idle and unauthenticated behavior, store outage, route
registration checks and route-report classification. Both families must pass on SQLite and
PostgreSQL for both strategies and peer floor/latest before release. Every issue runs `pnpm lint`,
`pnpm typecheck`, `pnpm build`, `pnpm quick:test`, `pnpm test:pg` and
`pnpm test:built-exports` on Node 24. Issues 4 and 5 also run `pnpm test:account-kit`. Mutation-check
each new guard by breaking it, observing its named test fail, then restoring it. The packed consumer
uses a fresh AdonisJS 7 host and the published exact Account Kit alpha; record exact dependency
versions for the strategy × database × peer floor/latest matrix. These are acceptance obligations,
not claims that implementation or verification has occurred; the requirement ledger tracks
evidence.

This section supersedes DEVELOPMENT-PLAN items 3 and 4 only for Account Kit managed routes,
SPEC §5.4's raw-business-route coverage rule only for those routes, §9's deferred status, and
§13.2/§13.4's store-free/raw-route classification only for those routes. Raw routes outside
`accountKit.*` retain their existing rules.
