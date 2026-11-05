# Security and operations

The [API entry-point map](https://kevinjohn.github.io/oss-adonisjs-masquerade/reference/index#supported-package-imports) links the HTTP context
middleware and route markers, and the native authority's host-owned account check boundary.

For a practical status → start → customer work → stop journey, see [Use a support mode](usage.md).

## Actor, target and scope

Masquerade is one server-side mode per `(namespace, actor ID, incarnation)`. It is visible to all
valid integrated sessions and authorized opaque tokens for that actor account. On each request the
route-selected native guard still authenticates the actor; the effective guard returns the target
to ordinary Auth and Bouncer code. The actor remains available separately for explicit policy and
audit. Actor permissions are never added to target permissions. See the
[access-token guide](access-tokens.md) for mixed and token-only configuration.

Logging out one browser session invalidates that session only. Another valid session continues to
see the shared mode. To end the mode for all devices, stop it or advance the account security stamp
through the application's logout-all/security policy. A valid native actor session can stop even
when the account stamp, actor eligibility, target, or start policy has changed. Stop reads the
owner's mode and expected context; it does not inspect the target or call start/admission policy.
An invalid native credential cannot stop because the host session guard rejects it first.

A reused account ID must have a new immutable incarnation so it cannot inherit a retired account's
mode or context token. `incarnation: 'id'` is a host declaration that IDs are never reused.
Namespaces name stable identity domains, not request-selected tenants. Guards for the same users
share one namespace. Distinct identity domains require distinct namespaces.

Provider identifiers, account incarnations and security stamps must be well-formed Unicode strings.
Malformed UTF-16 is rejected before UTF-8 byte limits or stamp hashing are applied; valid astral
characters remain supported. Security stamps are opaque and may contain control characters. A
control-store transition is accepted only when its audit event agrees with the owner and resulting
row, including the active target projection or the target being ended when the current row is
active.

## Authorization and route coverage

`canMasquerade` is mandatory and deny-by-default. It approves an actor and target at start, then is
rechecked for active business admission. A false result during active admission is a global
invalidation: the mode is cleared and that request receives context changed. Missing and ineligible
targets have the same generic denial so callers cannot enumerate accounts. A thrown policy or
authority check returns unavailable without changing the mode. `canUseRequest` is optional and
request-local; a false result rejects only that request, leaving the shared mode and revision
unchanged. This is where tenant- or route-specific restrictions belong. Tenant context is derived
after the effective identity is resolved, never inherited from the actor.

Refuse targets with the same or more privilege than the actor, such as other operators and
administrators. The package does not compare roles. An operator in edit mode as an administrator can
use any administrative route marked `allowMutation()`, for example to grant their own account a
role, and keeps that privilege after the mode ends.

Modes default to view access. The actor may request edit access when starting, but an
optional host `canEdit` policy must return exactly `true`; omitting the callback or returning any
other value never grants edit. `canMasquerade` keeps its existing role and input. For an edit start,
`canEdit({ actor, target, reason, request })` runs after `canMasquerade` and before
`canUseRequest`. View starts never call it.

On active edit-mode admission, the package rechecks `canEdit({ actor, target })` after
`canMasquerade`, without a reason or request. If it is absent or no longer returns exactly `true`,
the package clears the whole mode with `edit_denied` and rejects that request with 409; it does not
downgrade to view. A thrown callback returns 503 and leaves the mode unchanged. View-mode
admission and stop do not call `canEdit`. The accepted details are in the
[view-only and edit-access contract](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/maintainers/design/spec-masquerade.md#14-view-only-default-and-per-start-edit-access-accepted-22-october-2026).

After context-token validation, active requests follow this order: `sensitive()` blocks any method
with `blockedBy: 'sensitive'`; an unsafe method without edit access blocks with
`blockedBy: 'view_only'`; then an unsafe method without route or group `allowMutation()` blocks
with `blockedBy: 'mutation_not_allowed'`. Only an unsafe edit-mode request on an opted-in route proceeds
to the customer's ordinary authorization. GET, HEAD and OPTIONS remain reads in either access
level, subject to `sensitive()` and ordinary target authorization. The view-only response does not reveal whether a route
has `allowMutation()`. The host controls the error page, redirect or JSON response and its wording.

This rule does not prove that a GET handler has no side effects. Password, credential, identity,
recovery, security and billing mutations must carry `sensitive()`; the marker always wins over
access and `allowMutation()`. The package does not infer billing or security behavior from a URL.
The host owns this classification.

Login, signup, logout and status/start/stop control routes use the explicitly selected raw actor
guard. They never run target business handlers. Each covered business route selects one effective
session or token guard; raw business routes remain coverage defects. Never combine distinct raw
guards or fall back between cookie and bearer credentials. Use `masquerade:routes` to find
raw-guard routes requiring review. Keep public and authentication routes outside effective mode
admission and ensure they cannot dispatch business behavior.

Route selection reads the named `auth` router middleware. A route authenticated another way, such
as through middleware with a different name or a handler calling `auth.authenticate()` with no
route middleware, is `UNCLASSIFIED`. There the effective guard falls back to the raw guard and
returns the actor, `masqueradeContext` does not run, and audit fields and Edge status describe the
actor. Business work on such a route runs as the operator, not the target. Mount every business
route with `middleware.auth({ guards: [...] })` naming the effective guard, and resolve each
`UNCLASSIFIED` entry in [route coverage review](route-report.md).

The effective guards refuse an active-mode identity with 503 unless `masqueradeContext` ran for the
request, so a missing middleware, or one registered with `server.use` where no route is known yet,
fails closed instead of skipping view-only, `sensitive()` and context checks.

If native session authentication fails, `check()` returns `false`; calling `getUserOrFail()` after
that failed attempt raises the native session unauthorized error. Masquerade admission errors still
propagate unchanged.

## Account Kit admission and managed actions

The optional [Account Kit integration](account-kit.md) keeps admission distinct from account
restriction. Account Kit's `canAccess` decision controls authentication eligibility; it does not
include the separate host admission gate. Resolve `AccountAdmission` from
`@kevinjohn/adonisjs-account-kit/admission`. Gate the actor's protected control and business routes before the
global `masqueradeContext` middleware; route-level admission middleware runs too late when that
global middleware resolves the effective identity first. The [Account Kit guide](account-kit.md)
shows a scoped pre-context gate. A denied actor then receives the admission response before
Masquerade reads the mode, so the row remains unchanged. Use `changeRestriction` if the host intends
to advance the account revision and invalidate an active mode.

Check target admission from the host's `canMasquerade` callback with
`(await app.container.make(AccountAdmission)).isAdmitted(target.id)`. The callback runs at start and
active admission, so revoking a target's admission denies subsequent requests. Do not fold this
check into `canAccess`.

While a mode is active, the Account Kit provider's global blocker prevents managed account routes
from changing the operator's own password, credentials, identity, recovery settings or sessions.
The logout and CSRF endpoints remain available: logout must still work, and session clients need to
fetch a CSRF token to stop the mode. The integration preview documents its current scope and
verification status in the [Account Kit guide](account-kit.md).

## Context tokens and browser clients

Every covered unsafe business request requires the current owner-bound context token, including
when the actor is idle. The token is `<revision>.<nonce>` and is a replay/version guard, not an
authentication credential. The nonce differs by owner when no row exists and rotates on each
committed transition. Shield continues to provide CSRF protection for cookie requests.

For an Edge form, call `shareMasquerade(ctx)` before rendering, then include the token-only hidden
field alongside Shield's CSRF field:

```ts
// In the route handler
import { shareMasquerade } from '@kevinjohn/adonisjs-masquerade/http'

await shareMasquerade(ctx)
return ctx.view.render('pages/edit')
```

```edge
<form method="POST" action="/business/mutate">
  {{ csrfField() }}
  {{{ masqueradeContextField() }}}
  <button type="submit">Save</button>
</form>
```

Fetch and Inertia mutations can read `contextToken` from `GET /masquerade` and send it in
`X-Masquerade-Context` as well as the host's CSRF token:

```ts
await fetch('/business/mutate', {
  method: 'POST',
  headers: {
    'X-Masquerade-Context': contextToken,
    'X-CSRF-TOKEN': csrfToken,
  },
  body: formData,
})
```

If a request sends both header and form tokens, they must match. Missing context is 428; stale or
conflicting context is 409. Do not fetch a newer token and replay an old intent: refresh or rebuild
the user's action under the current mode first.
GET/HEAD/OPTIONS requests do not need the token, though active-mode policy still applies.

Start and stop always enforce their expected token. Business middleware may run in `report` while
the host migrates forms; it logs would-be missing/stale errors and admits the request. Report mode
is not a stale-form protection boundary. Inventory all rendered forms and clients, deploy token
submission, verify the warnings have stopped, then switch to `enforce` before relying on stale
intent rejection.

## Duration, transition and recovery behavior

The default duration is 900 seconds; the maximum is 3600 seconds and a host may narrow both. Expiry
is fixed and does not slide with activity. At the deadline, a business request that discovers
expiry or global invalidity is rejected and never continues as the actor. A fresh request sees the
current state. A local tenant denial does not clear the shared mode.

Expiry cleanup is lazy. `status()` is a read-only projection of the persisted row; it does not check
the deadline, clear the row, advance its revision, or emit an expiry event. Until business admission
or expiry cleanup performs the durable compare-and-swap transition, status can therefore return
`isMasquerading: true` after `expiresAt`. For presentation, treat the mode as usable only when
`isMasquerading` is true **and** `expiresAt` is strictly later than the current time. The boolean
alone reports persisted state, not whether a new business request can still be admitted.

When a business request is rejected with context changed because expiry was discovered, refresh
status and the rendered context before presenting the current state. Do not automatically replay the
rejected action: the user's intent may be stale, and a refreshed context token does not authorize
that old intent. Ask the user to initiate a fresh action when appropriate.

A nested start cannot replace, renew, or extend an active mode. Stop, then submit a fresh start with
the newly rendered context. Every successful transition atomically updates the row and audit event.
If the database loses the commit acknowledgement, the service returns 503 and logs the transition
ID; use `GET /masquerade` to recover the current state. Do not retry a start using the old intent.
Status returns only the authenticated owner's safe mode view and sends `Cache-Control: no-store`.
When the store is unavailable, status and stop return 503; login and logout still use native auth and
do not read mode state. Package errors carry stable codes and fixed English fallbacks. The default JSON handler looks
up `errors.<code>` through the request's i18n instance when present, while the host owns custom
presentation. The handler keeps the generic JSON envelope and status with `Cache-Control: no-store`.
The package ships no translation catalog or loader.

While masquerading, the operator's browser renders the target's content on the application's
origin with the operator's own cookies. A stored script the target could inject, which would
otherwise reach only that customer, now runs as the operator: it can read the context and CSRF
tokens and call the operator's raw-guard routes, including start and stop for other targets. Escape
target-controlled content and set a Content Security Policy before giving operators access.

## Jobs, external effects and audit

A request admitted before stop or expiry may finish. Masquerade cannot undo work already admitted,
queued, sent to another service, or committed in a separate system. Jobs and downstream messages do
not inherit a trusted effective context automatically. If a job needs actor/effective attribution,
carry the safe `ResolvedContext` projection and apply the host's own authorization when it runs.
Irreversible actions need host transaction-time guards where appropriate.

Committed starts, stops, expiry and global invalidation have durable audit events. After native
authentication, CSRF and the control limiter succeed, admitted start/stop denials, invalid controls,
context conflicts and idle-stop no-ops are also recorded when the store is available. A start
denial records the requested target ID and access, never an incarnation the authority returned. Authentication
failures, pre-boundary CSRF/limiter rejections, status/business denials and local tenant denials use
host diagnostics instead. A successful start audit stores its normalized reason, or none when the reason policy is optional
and no reason was given. Set `reason: 'required'` when compliance needs a justification for every
start. Denied or invalid
control attempts omit the reason. Do not use reasons as case notes; avoid secrets and unnecessary
personal data. Status, observer projections and operational logs never expose raw stamps,
credentials, request bodies or user objects.

Observers run after commit without delaying the response. Delivery is best effort. Rejected
observers are sent to the emitter error handler and cannot reverse a committed transition. If the
error handler throws or rejects, Masquerade makes a best-effort call to the configured logger's
`error` method with only a bounded category, operation and stable error code. Synchronous logger
throws and rejected logger promises are swallowed; this final report is not guaranteed to be
delivered.

Core operational diagnostics use the same bounded fields for store, authority, policy, control and
configuration failures. They omit actor and target identifiers, reasons, stamps, request bodies,
user objects and raw error values. A lost commit acknowledgement also logs its transition ID so an
operator can correlate the uncertain transition with recovery status. The public error response
remains generic.

Retention belongs to the host. With `retention: { days: n }`, `masquerade:prune --batch-size=100`
expires due modes and removes old events in bounded batches. Pruning is global across every
validated namespace visible through the supplied store; it is not limited to
`config.authority.namespace`. One retention policy applies to that store, so use separately scoped
stores when identity domains need different retention policies. With `'host-managed'`, pruning
expires modes and leaves events to the host. Idle owner rows are retained so old pre-start tokens
cannot become valid again. For account erasure, delete the retired incarnation's mode row and apply
the host's event-retention policy; no erasure API is provided. Review the SQL against the installed
schema and database before using it. Replace `?` with the parameter syntax your database driver
requires and bind the values; do not interpolate them into SQL:

```sql
DELETE FROM masquerade_modes
WHERE authority_namespace = ?
  AND actor_id = ?
  AND actor_incarnation = ?;

-- Bind namespace, actor ID, and retired incarnation as parameters.
-- Apply your approved retention policy to masquerade_events separately.
```

Lucid supports SQLite and PostgreSQL through an optional subpath. On PostgreSQL, a failed `ROLLBACK`
retires only that connection, because the server discards the transaction with its session. On
SQLite, if native cleanup fails after a failed `COMMIT`, the store fails closed and shuts down its shared Lucid write pool rather than
returning a connection with uncertain transaction state. This can also fail unrelated application
queries using that pool. After the host reconnects or restarts, create a new store adapter; do not
reuse the retired connection. The adapter rejects externally managed pools because it cannot
safely retire them. Treat this rare path as an application database outage and use the host's
normal recovery and alerting procedures.
