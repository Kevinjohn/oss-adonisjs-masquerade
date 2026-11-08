# M4 requirement-to-evidence ledger

This page preserves the M4 assessment and later dated matrices. Current verification commands
are in [Verification](verification.md); record current candidate outcomes in its pull request checks.

**Recorded M4 status:** M4 verification is complete for the release candidate described here. M0–M3 evidence is recorded in [M3-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M3-RESULT.md). After the async migration correction, `pnpm test` passed 162 SQLite tests, `pnpm test:pg` passed 158 PostgreSQL 16 tests (server stopped cleanly), and build, typecheck and two built-export checks passed. Six configure/migration cases pass; floor/latest generated scaffolds compile; the native credential case passes 1/1. All four packed floor/latest × SQLite/PostgreSQL 16.15 cells passed, for 72 functional, report and credential executions. Exact versions and artifact identity are recorded below. This verification does not imply publication.

**Authority and scope:** The accepted `development-plan.md` wins where it narrows SPEC/PRD. v1 is native session only; opaque access-token adapter is v1.1 and JWT is out. The Account Kit adapter and managed-route blocker are accepted v1.2 scope and are implemented in the open PR stack. The pinned GitHub release artifact `adonisjs-account-kit@0.1.3` passed all 16 floor/latest SQLite/PostgreSQL cells across both strategies and session-management settings on 27 October 2026; `0.1.1` passed the same matrix on 22 October 2026 and is no longer declared. Public registry publication is a separate distribution step, not an integration acceptance gate. Core retains the native `securityStamp`/`inspectAccount` contract and no Account Kit dependency. Cut JSON:API negotiation, package translation catalog/loader/locale setting, and 4x2x2 consumer matrix. Error messages may use optional request-context `i18n` lookup by stable `errors.<code>` with English fallback. FR-09 uses route-report release gate; FR-14 owner-bound revision.nonce + report/enforce; FR-21/22 SHA-256 stamps; FR-30 emit-and-forget; indeterminate commit 503 + transition ID + status recovery. Consumer target is one native-session packed consumer at floor/latest on SQLite/PostgreSQL.

Legend: evidence names a concrete current test case; statements explicitly identified as optional are integration-depth opportunities, not uncovered acceptance requirements. M3 outcomes are recorded in [M3-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M3-RESULT.md). Documentation obligations are linked to user guides; link checks do not establish semantic completeness.

## Functional requirements

| Requirement | Evidence                      |
| ----------- | ----------------------------- |
| FR-01       | [Coverage and limits](#fr-01) |
| FR-02       | [Coverage and limits](#fr-02) |
| FR-03       | [Coverage and limits](#fr-03) |
| FR-04       | [Coverage and limits](#fr-04) |
| FR-05       | [Coverage and limits](#fr-05) |
| FR-06       | [Coverage and limits](#fr-06) |
| FR-07       | [Coverage and limits](#fr-07) |
| FR-08       | [Coverage and limits](#fr-08) |
| FR-09       | [Coverage and limits](#fr-09) |
| FR-10       | [Coverage and limits](#fr-10) |
| FR-11       | [Coverage and limits](#fr-11) |
| FR-12       | [Coverage and limits](#fr-12) |
| FR-13       | [Coverage and limits](#fr-13) |
| FR-14       | [Coverage and limits](#fr-14) |
| FR-15       | [Coverage and limits](#fr-15) |
| FR-16       | [Coverage and limits](#fr-16) |
| FR-17       | [Coverage and limits](#fr-17) |
| FR-18       | [Coverage and limits](#fr-18) |
| FR-19       | [Coverage and limits](#fr-19) |
| FR-20       | [Coverage and limits](#fr-20) |
| FR-21       | [Coverage and limits](#fr-21) |
| FR-22       | [Coverage and limits](#fr-22) |
| FR-23       | [Coverage and limits](#fr-23) |
| FR-24       | [Coverage and limits](#fr-24) |
| FR-25       | [Coverage and limits](#fr-25) |
| FR-26       | [Coverage and limits](#fr-26) |
| FR-27       | [Coverage and limits](#fr-27) |
| FR-28       | [Coverage and limits](#fr-28) |
| FR-29       | [Coverage and limits](#fr-29) |
| FR-30       | [Coverage and limits](#fr-30) |
| FR-31       | [Coverage and limits](#fr-31) |

### FR-01

- **Positive / success obligation:** Shared server owner row keyed namespace + actor ID + incarnation; integrated session devices resolve same mode.
- **Negative, error, boundary obligations:** Client actor substitution, reused ID/incarnation and namespace collision must not inherit mode.
- **Docs / M4 obligation:** Explain account-level scope and cross-device visibility.
- **Current concrete evidence / remaining gap:** `tests/core_authorization.spec.ts` — “incarnation and namespace isolate rows and no-row contexts; client actor substitution rejected”; `tests/core_service.spec.ts` — “two devices starting at the same context produce one winner and no fallback”; `examples/native-session/tests/functional/effective_guard.spec.ts` — “two active operators see separate persisted targets”. Documented in [security guide](../guide/security.md).

### FR-02

- **Positive / success obligation:** Native session authenticates actor on every request; preserve normal native guard/session behavior.
- **Negative, error, boundary obligations:** No target credential/session/cookie issuance or actor replacement; logout/unauthenticated behavior stays native.
- **Docs / M4 obligation:** Explain session-only adapter, native remember-me/cookie and credential limits.
- **Current concrete evidence / remaining gap:** `tests/session_authority.spec.ts` — “native authority uses provider canonical identity rather than model id and preserves native user”; `examples/native-session/tests/functional/masquerade_context.spec.ts` — “does not mint target credentials and never unions actor Bouncer access”; `examples/native-session/tests/functional/effective_guard.spec.ts` — “driverName keeps native unauthenticated HTML and JSON behavior”; `examples/native-session/tests/credentials/native_credentials.spec.ts` — “recovers the raw actor through remember-me after native session expiry while the effective guard keeps the admitted target” verifies remembered and non-remembered recovery/control behavior without target tokens.

### FR-03

- **Positive / success obligation:** Effective guard facade and ordinary Bouncer use target; actor stays separately accessible.
- **Negative, error, boundary obligations:** Must not leave actor in facade / no identity fallback on failures.
- **Docs / M4 obligation:** Explain actor vs effective identity.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/effective_guard.spec.ts` — “facade, raw actor, Bouncer and silent_auth retain their identities across start and stop”; `tests/effective_session_guard.spec.ts` — “business guard owns the facade while the raw guard retains actor identity; failures never fall back”. M3 real-fixture gate passed; see [M3-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M3-RESULT.md).

### FR-04

- **Positive / success obligation:** Bouncer ordinary check uses target permissions.
- **Negative, error, boundary obligations:** Actor permissions never unioned.
- **Docs / M4 obligation:** Explain host owns authorization.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/masquerade_context.spec.ts` — “does not mint target credentials and never unions actor Bouncer access”.

### FR-05

- **Positive / success obligation:** Idle→active start and stop→new start sequence.
- **Negative, error, boundary obligations:** Nested/same-target start rejected, no target/expiry/revision mutation.
- **Docs / M4 obligation:** Explain stop then fresh-context start to switch target.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “starts, rejects nesting, stops and preserves idle revisions”; “stale start and stop cannot overwrite or clear the current winner”. Documented in [security guide](../guide/security.md).

### FR-06

- **Positive / success obligation:** CAS revision advances atomically on valid start/stop/invalidation/expiry.
- **Negative, error, boundary obligations:** Concurrent requests have one winner; stale token/CAS cannot overwrite; exhaustion fails closed.
- **Docs / M4 obligation:** Explain revisions as stale-form mechanism, not credential.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “stale start and stop cannot overwrite or clear the current winner”; “two devices starting at the same context produce one winner and no fallback”; “revision exhaustion fails closed without wrapping or transitions”; `tests/lucid_control_store.spec.ts` — “independent connections race absent and existing owner with exactly one audit event per winner”. The [M3-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M3-RESULT.md) entry records the PostgreSQL root run; the final packed floor/latest SQLite/PostgreSQL matrix also passes as recorded below.

### FR-07

- **Positive / success obligation:** Fixed expiry at configured deadline; host may narrow 900/3600 defaults.
- **Negative, error, boundary obligations:** No sliding, exact boundary expires, invalid bounds fail; trigger does not execute.
- **Docs / M4 obligation:** Explain duration defaults, hard max and host narrowing.
- **Current concrete evidence / remaining gap:** `tests/core_admission.spec.ts` — “exact expiry clears durably without stamp access and rejects the triggering request”; `tests/core_authorization.spec.ts` — “duration boundaries, host narrowing and invalid input audit do not leak rejected reason”; `tests/prune.spec.ts` — “does not clear a newer revision after an expired batch snapshot”. Documented in [security guide](../guide/security.md).

### FR-08

- **Positive / success obligation:** Mountable status/start/stop routes derive actor natively.
- **Negative, error, boundary obligations:** CSRF and body/field validation; no actor ID authority from payload.
- **Docs / M4 obligation:** Document route mounting, Shield CSRF and limiter.
- **Current concrete evidence / remaining gap:** `tests/http_controllers.spec.ts` — “accepts Shield form transport without treating its CSRF field as package input”; “accepts canonical form duration strings but keeps JSON number validation strict”; `examples/native-session/tests/functional/masquerade_context.spec.ts` — “keeps raw actor routes and login/logout available without store reads during outage”. Host limiter placement and independent budgets are documented in [setup](../guide/setup.md); direct limiter integration is host-owned.

### FR-09

- **Positive / success obligation:** Effective-guard business routes classified and report lists by guard/markers.
- **Negative, error, boundary obligations:** Raw-guard business route flagged; no boot-time registry requirement.
- **Docs / M4 obligation:** Host route report review is release gate; document route coverage.
- **Current concrete evidence / remaining gap:** `tests/routes_command.spec.ts` — “reports routes from the actual router grouped by guard and marker”; `tests/route_metadata.spec.ts` — “classifies business routes from their matched auth guard metadata”; “reads marker and guard options from a real Adonis router route”. Report review is documented in [setup](../guide/setup.md) and [README-AGENTS.md](../guide/agents.md).

### FR-10

- **Positive / success obligation:** Valid actor session credential with control capability can stop without start permission/target load.
- **Negative, error, boundary obligations:** Invalid native credential denied; stale expected token cannot clear newer mode.
- **Docs / M4 obligation:** Explain recovery stop available across actor sessions.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “stop ignores target deletion, denied policies and failing stamp access”; “stale start and stop cannot overwrite or clear the current winner”; `tests/core_failures.spec.ts` — “status and stop fail closed on store read failure without account or policy reads”; real cookie case in `examples/native-session/tests/functional/masquerade_context.spec.ts` — “logout ends only the actor session that submitted it” proves the surviving actor session sees shared mode and can stop/recover.

### FR-11

- **Positive / success obligation:** Stop, expiry and global invalidation clear + advance revision.
- **Negative, error, boundary obligations:** Triggering business request, including safe request discovering invalidity, never falls back.
- **Docs / M4 obligation:** Explain invalidation and expiry behavior.
- **Current concrete evidence / remaining gap:** `tests/core_admission.spec.ts` — “exact expiry clears durably without stamp access and rejects the triggering request”; “global invalidity ${invalidation} clears once and never admits the triggering request”; `tests/core_failures.spec.ts` — “conflicting expiry cannot clear a newer committed selection”. The real-cookie test “logout ends only the actor session that submitted it” changes the actor stamp and observes 409 on the next safe GET before the following GET sees idle actor identity; core expiry tests cover the exact deadline.

### FR-12

- **Positive / success obligation:** One-session logout ends only credential, shared mode remains.
- **Negative, error, boundary obligations:** Logout does not silently clear account setting.
- **Docs / M4 obligation:** Document one-session logout versus logout-all and account-stamp behavior.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/masquerade_context.spec.ts` — “logout ends only the actor session that submitted it” exercises two independent actor cookie sessions, shared target mode, logout of one session, surviving session continuation, target credential validity, no additional login attempts, then actor stamp change returning 409 and a fresh idle request.

### FR-13

- **Positive / success obligation:** Any valid integrated session sees shared setting; in-flight admitted request is immutable.
- **Negative, error, boundary obligations:** Stop/revision after admission does not rewrite already-admitted identity; no recall guarantee.
- **Docs / M4 obligation:** Docs explicitly cover cross-device and in-flight/asynchronous limits.
- **Current concrete evidence / remaining gap:** `tests/request_admission.spec.ts` — “the admitted mode view retains its token and deadline after another request stops”; `tests/core_admission.spec.ts` — “memoizes admission outcomes and freezes safe identity across later mode changes”. Cross-device and in-flight limits are documented in [security guide](../guide/security.md).

### FR-14

- **Positive / success obligation:** Owner-bound `<revision>.<nonce>` on covered unsafe requests, idle and active; header or hidden field.
- **Negative, error, boundary obligations:** Missing 428, stale 409, malformed/query-only/wrong owner/conflicting header/form fail; report logs and admits; enforce rejects.
- **Docs / M4 obligation:** Document idle-everywhere rule and report→enforce rollout, hidden field + Inertia/fetch header.
- **Current concrete evidence / remaining gap:** `tests/context_token.spec.ts` — “absent tokens are deterministic and length-framed owner-bound”; “A to idle to A rotates nonce and never revives old tokens”; `tests/http_context_middleware.spec.ts` — “requires context on idle unsafe routes in report mode and ignores query state”; “reports header and form token disagreement as stale context”; `examples/native-session/tests/functional/masquerade_context.spec.ts` — “issues owner-specific idle tokens and denies missing, malformed, and query-only contexts”; `examples/native-session/tests/report/context.spec.ts` — “logs a missing owner context and continues the idle business request”. Report→enforce migration is documented in [security guide](../guide/security.md); M3 report/enforce outcomes are in [M3-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M3-RESULT.md).

### FR-15

- **Positive / success obligation:** Current token permits covered intent.
- **Negative, error, boundary obligations:** Missing/stale tokens reject with 428/409 and handler is not run.
- **Docs / M4 obligation:** Document status refresh and never refresh/replay old intent.
- **Current concrete evidence / remaining gap:** `tests/context_token.spec.ts` — “bounded malformed tokens require context while valid wrong owner tokens are stale”; `tests/http_context_middleware.spec.ts` — “context token errors take precedence over the access rule”; `examples/native-session/tests/functional/masquerade_context.spec.ts` — “rejects cross-owner and conflicting header/form context tokens”. Client replay guidance is in [security guide](../guide/security.md).

### FR-16

- **Positive / success obligation:** View-only by default; edit requires per-start `canEdit === true`, active admission revalidates it, and ordinary mutations also require `allowMutation()` and target authorization.
- **Negative, error, boundary obligations:** Fail closed for missing/unknown access; sensitive always blocks.
- **Docs / M4 obligation:** [Security and operations](../guide/security.md#authorization-and-route-coverage) explains the default, policy call order and revocation; [route report](../guide/route-report.md#coverage-labels) explains route markers; [access-token guide](../guide/access-tokens.md#share-account-authority-with-sessions) states that bearer tokens share the account level.
- **Current concrete evidence / remaining gap:** D1–D10 accepted 2026-10-22. #87 cases: `tests/core_service.spec.ts` — “start stores view by default and edit when requested”; `tests/core_authorization.spec.ts` — “edit start requires canEdit literal true; absent, false, non-boolean and throw do not start”; `tests/row_validation.spec.ts` — “access fails closed”. #90 cases in `tests/http_context_middleware.spec.ts`: “view mode blocks unsafe requests on allowMutation routes with view_only”; “view mode blocks unsafe requests on unmarked routes with view_only, not mutation_not_allowed”; “an admitted context without access, and one with an unknown value, is blocked with view_only”; “edit mode with allowMutation reaches the handler under the target”. Implemented and verified in the SQLite and PostgreSQL root suites for this batch; delivery remains pending PR merge.

### FR-17

- **Positive / success obligation:** Sensitive credential/security/billing mutation blocked.
- **Negative, error, boundary obligations:** `sensitive()` beats `allowMutation()`; billing denied.
- **Docs / M4 obligation:** Document sensitive categories and billing rule.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/masquerade_context.spec.ts` — “enforces unsafe action markers, with sensitive taking precedence over allowMutation” marks synthetic billing route both `allowMutation()` and `sensitive()`. The settled requirement is host marking; URL semantics are never inferred.

### FR-18

- **Positive / success obligation:** Safe request target auth; opted-in unsafe request target auth; both actor/effective context available.
- **Negative, error, boundary obligations:** No safe-method safety promise; jobs/external work need host validation.
- **Docs / M4 obligation:** Docs cover target-facing authorization and job/downstream limitations.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/effective_guard.spec.ts` — “facade, raw actor, Bouncer and silent_auth retain their identities across start and stop”; `examples/native-session/tests/functional/masquerade_context.spec.ts` — “does not mint target credentials and never unions actor Bouncer access”; `tests/request_admission.spec.ts` — “internal admission freezes copied Subject shells and preserves native model references”. Job/queue limitations are documented in [security guide](../guide/security.md); application-specific job tests remain host-owned.

### FR-19

- **Positive / success obligation:** New requests see changed identity after mode changes.
- **Negative, error, boundary obligations:** Expiry/global validity/context change rejects triggering business work; never executes as actor.
- **Docs / M4 obligation:** Explain admitted vs later request.
- **Current concrete evidence / remaining gap:** `tests/core_admission.spec.ts` — “exact expiry clears durably without stamp access and rejects the triggering request”; “global invalidity ${invalidation} clears once and never admits the triggering request”; `tests/effective_session_guard.spec.ts` — “business guard owns the facade while the raw guard retains actor identity; failures never fall back”; `examples/native-session/tests/functional/masquerade_context.spec.ts` — “logout ends only the actor session that submitted it” changes the actor stamp, receives 409 on the next safe GET, then observes idle actor identity.

### FR-20

- **Positive / success obligation:** Required deny-by-default `canMasquerade`; optional request-local `canUseRequest`; explicit actor+target.
- **Negative, error, boundary obligations:** false/throw cases prescribed; global false clears active mode, local false rejects one request and preserves mode, throws 503 and preserve state; no fallback.
- **Docs / M4 obligation:** Document callback signature/semantics, no callback default.
- **Current concrete evidence / remaining gap:** `tests/core_authorization.spec.ts` — “start denies false and truthy nonboolean policy; policy throws unavailable; no revision change”; “start policy receives reason/request and admission policy gets neither; local tenant denial preserves revision”; `tests/core_admission.spec.ts` — “global invalidity ${invalidation} clears once and never admits the triggering request”; “credential and local denial preserve mode; native rejection writes no package event”; “read failure rejects admission as unavailable with mode unchanged”. The real `examples/native-session/tests/functional/masquerade_context.spec.ts` — “applies the host operator policy when starting from an idle actor context” covers start policy; core case covers local tenant denial.

### FR-21

- **Positive / success obligation:** Every request uses raw session auth; host stamp detects account epoch; stored SHA-256, actor+target checked each active admission.
- **Negative, error, boundary obligations:** Credential rejection denies only that request; stamp change invalidates; stop/expiry do not read stamp.
- **Docs / M4 obligation:** Explain host’s stamp responsibility and logout-all mapping.
- **Current concrete evidence / remaining gap:** `tests/security_stamp.spec.ts` — “hashes opaque stamps with a512 UTF8 byte bound without storing plaintext”; `tests/core_admission.spec.ts` — “credential and local denial preserve mode; native rejection writes no package event”; “exact expiry clears durably without stamp access”; `tests/core_service.spec.ts` — “stop ignores target deletion, denied policies and failing stamp access”; `tests/session_authority.spec.ts` — “native adapter retains configured namespace/guard and callback receivers”; `examples/native-session/tests/credentials/native_credentials.spec.ts` — “recovers the raw actor through remember-me after native session expiry while the effective guard keeps the admitted target” verifies unauthorized controls preserve the row/event count, raw/effective access, and successful recovered controls. Documented in [security guide](../guide/security.md).

### FR-22

- **Positive / success obligation:** Account-wide target eligibility check separate from per-request tenant; target incarnation/stamp checked.
- **Negative, error, boundary obligations:** Null/inactive/throw/global false invalidates or fails closed; local tenant false preserves revision.
- **Docs / M4 obligation:** Document callback and local-vs-global distinction.
- **Current concrete evidence / remaining gap:** `tests/core_authorization.spec.ts` — “start denies false and truthy nonboolean policy; policy throws unavailable; no revision change”; “actor and target deletion invalidate an admitted native actor without target fallback”; “start policy receives reason/request and admission policy gets neither; local tenant denial preserves revision”; `tests/core_admission.spec.ts` — “global invalidity ${invalidation} clears once and never admits the triggering request”.

### FR-23

- **Positive / success obligation:** Revoked current session cannot authenticate; another valid credential can retain account mode.
- **Negative, error, boundary obligations:** Do not clear global row solely on single credential rejection; changed account stamp clears.
- **Docs / M4 obligation:** Docs distinguish one credential logout vs logout-all.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/masquerade_context.spec.ts` — “logout ends only the actor session that submitted it” proves the second valid session retains mode; the same test checks the account-stamp invalidation path.

### FR-24

- **Positive / success obligation:** **Accepted v1.2:** optional Account Kit subpath uses coherent inspection snapshots, preserves native actor authentication, adds no target credentials, and blocks managed routes under the accepted contract. Core does not import Account Kit.
- **Negative, error, boundary obligations:** v1.2 adapter and managed-route behavior; full scope in [SPEC §15](design/spec-masquerade.md#15-v12-account-kit-integration).
- **Docs / M4 obligation:** Implementation and T-KIT/T-KIT-HTTP verification are complete for the pinned `0.1.3` release artifact across floor/latest, SQLite/PostgreSQL, both strategies and session-management settings.
- **Current concrete evidence / remaining gap:** `tests/account_kit_authority.spec.ts`, `tests/account_kit_service.spec.ts`, the six packed Account Kit integration suites, and `tests/package_exports.spec.ts` provide adapter, HTTP and optional-core-boundary evidence. Exact packed matrix results and artifact hashes are recorded below.

### FR-25

- **Positive / success obligation:** **Retained:** native session transport only, raw actor stays actor.
- **Negative, error, boundary obligations:** Opaque access-token adapter v1.1; token guards cannot start/use/stop; JWT out.
- **Docs / M4 obligation:** Docs clearly state session-only support.
- **Current concrete evidence / remaining gap:** `tests/session_authority.spec.ts` — “native adapter rejects an actual non-session raw guard before credential validation”; `tests/effective_session_guard.spec.ts` — “effective wrapper rejects non-session native drivers”. Session-only scope is stated in [setup](../guide/setup.md) and [security](../guide/security.md).

### FR-26

- **Positive / success obligation:** Transition row + event atomic; admitted start/stop denials/context/input conflicts/noops audit; `recordControlOutcome` failure prevents action.
- **Negative, error, boundary obligations:** Pre-boundary auth/CSRF/limiter and business/status/local denials no package record; unknown outcome maps unavailable.
- **Docs / M4 obligation:** Explain audit boundary and host diagnostics/limiter.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “matching idle stop records a noop and never rotates the context”; `tests/http_controllers.spec.ts` — “routes malformed control input through core auditing and renders the public error”; `tests/core_failures.spec.ts` — “CAS write and required outcome failures return 503 and leave authoritative state unchanged”; `tests/lucid_control_store.spec.ts` — “audit payload survives storage and duplicate event failures roll back insert and update”; “independent connections race absent and existing owner with exactly one audit event per winner”. Setup guide documents CSRF and host limiter boundary. A dedicated end-to-end assertion combining host CSRF/limiter rejection with package event-count inspection would be optional integration-depth evidence; the package control boundary and host-owned limiter/CSRF placement are covered separately and this is not an uncovered acceptance requirement.

### FR-27

- **Positive / success obligation:** Audit includes actor/target IDs+incarnations, namespace, timestamp, kind/outcome, reason as applicable; requested vs completed represented.
- **Negative, error, boundary obligations:** Never claim denial on indeterminate commit; no false observer success.
- **Docs / M4 obligation:** Explain retained data/retention.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “start persists bounded reason and hashes; projections and observers expose only safe fields”; `tests/lucid_control_store.spec.ts` — “audit payload survives storage and duplicate event failures roll back insert and update” deep-compares all persisted event columns (ID, mode/owner keys, target identity, timestamp, kind, outcome, revision and reason); `tests/core_failures.spec.ts` — “indeterminate committed start logs a safe diagnostic and never emits or records a false denial”; “indeterminate committed stop does not emit success or record a false denial”. Settled reason policy is recorded below.

### FR-28

- **Positive / success obligation:** Safe public view/events/log projections.
- **Negative, error, boundary obligations:** No credentials, stamps, raw users, request bodies, reason leakage in status/error/log/event.
- **Docs / M4 obligation:** Explain audit minimization and host reason hygiene.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “start persists bounded reason and hashes; projections and observers expose only safe fields”; `tests/core_authorization.spec.ts` — “duration boundaries, host narrowing and invalid input audit do not leak rejected reason”; `tests/core_failures.spec.ts` — “authority and local-policy throws preserve mode without admitting or logging secrets”; `tests/security_stamp.spec.ts` — “hashes opaque stamps with a512 UTF8 byte bound without storing plaintext”.

### FR-29

- **Positive / success obligation:** Valid reason normalized/persisted within codepoint + UTF-8 byte bounds.
- **Negative, error, boundary obligations:** Trim→CRLF→controls order; C0/C1 except LF/tab rejected; empty/whitespace, >500 codepoints, >2000 bytes rejected; no truncation.
- **Docs / M4 obligation:** Tell operators redact secrets and personal data.
- **Current concrete evidence / remaining gap:** `tests/reason.spec.ts` — “normalizes reason in trim, CRLF then controls order”; “counts Unicode code points and UTF8 bytes at the allowed boundaries”; “bounds the normalized reason after trimming arbitrary whitespace padding”; `tests/core_authorization.spec.ts` — “duration boundaries, host narrowing and invalid input audit do not leak rejected reason”. Operator guidance to redact secrets and unnecessary personal data is in [security guide](../guide/security.md).

### FR-30

- **Positive / success obligation:** Commit result returned independent of observer; log/emitter integration after commit.
- **Negative, error, boundary obligations:** Sync throw, rejected and never-settling observer/reporter cannot alter or hang response; indeterminate emits nothing.
- **Docs / M4 obligation:** Document best-effort observer delivery if public API promises it.
- **Current concrete evidence / remaining gap:** `tests/core_failures.spec.ts` — “observer sync throws, rejected promises and rejected reporter cannot alter a committed result”; “never-settling observers are not awaited”; “indeterminate committed start logs a safe diagnostic and never emits or records a false denial”; “indeterminate committed stop does not emit success or record a false denial”; `tests/masquerade_runtime.spec.ts` — “provider binds a singleton real runtime and native emitter error handling sees safe committed projection”.

### FR-31

- **Positive / success obligation:** ControlStore and optional Lucid SQLite/PG; memory only test.
- **Negative, error, boundary obligations:** Core import does not resolve Lucid/Account Kit; SQL atomic event + CAS, malformed values fail closed.
- **Docs / M4 obligation:** Document optional store and supported dialects.
- **Current concrete evidence / remaining gap:** `tests/package_exports.spec.ts` — “imports the core without resolving optional integrations”; `tests/lucid_control_store.spec.ts` — “exports the complete store conformance on a real database”; “read rejects malformed persisted rows including unsafe BIGINT and noncanonical UTC”; `tests/lucid_schema.spec.ts` — “migration stub respects Lucid dry-run, creates once and rolls back both tables”. M2 database evidence and outcomes are linked in [M2-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M2-RESULT.md).

## Non-functional requirements

| Requirement | Evidence                       |
| ----------- | ------------------------------ |
| NFR-01      | [Coverage and limits](#nfr-01) |
| NFR-02      | [Coverage and limits](#nfr-02) |
| NFR-03      | [Coverage and limits](#nfr-03) |
| NFR-04      | [Coverage and limits](#nfr-04) |
| NFR-05      | [Coverage and limits](#nfr-05) |
| NFR-06      | [Coverage and limits](#nfr-06) |
| NFR-07      | [Coverage and limits](#nfr-07) |
| NFR-08      | [Coverage and limits](#nfr-08) |

### NFR-01

- **Obligations:** No target/action on read/policy/auth/malformed/indeterminate failures; no-row idle differs from read error.
- **Current concrete evidence / remaining gap:** `tests/row_validation.spec.ts` — “malformed store rows fail closed across status, controls and admission”; `tests/core_failures.spec.ts` — “CAS write and required outcome failures return 503 and leave authoritative state unchanged”; “status and stop fail closed on store read failure without account or policy reads”; `tests/core_admission.spec.ts` — “read failure rejects admission as unavailable with mode unchanged”; no-row context `tests/context_token.spec.ts` — “absent tokens are deterministic and length-framed owner-bound”.

### NFR-02

- **Obligations:** Same owner row cross-session; atomic CAS under independent connections.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “two devices starting at the same context produce one winner and no fallback”; `tests/lucid_control_store.spec.ts` — “independent connections race absent and existing owner with exactly one audit event per winner”; Real cross-device session proof is `examples/native-session/tests/functional/masquerade_context.spec.ts` — “logout ends only the actor session that submitted it”.

### NFR-03

- **Obligations:** Revision change stales unsafe intent; admitted intent not revoked.
- **Current concrete evidence / remaining gap:** `tests/context_token.spec.ts` — “A to idle to A rotates nonce and never revives old tokens”; `tests/http_context_middleware.spec.ts` — “requires context on idle unsafe routes in report mode and ignores query state”; “context token errors take precedence over the access rule”; `tests/request_admission.spec.ts` — “the admitted mode view retains its token and deadline after another request stops”. Documented in [security guide](../guide/security.md).

### NFR-04

- **Obligations:** Restart/recovery reads durable source; ambiguous CAS denied, no inferred client state.
- **Current concrete evidence / remaining gap:** `tests/core_failures.spec.ts` — “indeterminate committed start logs a safe diagnostic and never emits or records a false denial”; “indeterminate committed stop does not emit success or record a false denial”; `tests/lucid_control_store.spec.ts` — “lost commit acknowledgement returns indeterminate without retry or compensation”. A dedicated process-restart fixture is optional integration-depth evidence; durable state reads and indeterminate recovery are covered by the named store/service cases.

### NFR-05

- **Obligations:** Host owns auth/CSRF/session; context is not auth.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/masquerade_context.spec.ts` — CSRF form, login/logout, no target credentials; `tests/context_token.spec.ts` — owner-bound but not secret. Documented in [security guide](../guide/security.md).

### NFR-06

- **Obligations:** Adonis 7/Auth10/Session8 idioms, Node24/pnpm.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/effective_guard.spec.ts` — “facade, raw actor, Bouncer and silent_auth retain their identities across start and stop”; package engine/packageManager declared. M3 fixture gate passed ([M3-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M3-RESULT.md)); packed floor/latest dependency behavior is verified across the four M4 consumer cells below.

### NFR-07

- **Obligations:** Core works without Lucid/Account Kit.
- **Current concrete evidence / remaining gap:** `tests/package_exports.spec.ts` — “imports the core without resolving optional integrations”.

### NFR-08

- **Obligations:** Docs account scope/logout/revocation/transport/context/routes/side effects.
- **Current concrete evidence / remaining gap:** Documented in [security and operations](../guide/security.md). `tests/docs_links.spec.ts` verifies tracked relative links and anchors, not semantic completeness; ledger review is the acceptance check for content.

## Acceptance criteria

| Requirement | Evidence                      |
| ----------- | ----------------------------- |
| AC-01       | [Coverage and limits](#ac-01) |
| AC-02       | [Coverage and limits](#ac-02) |
| AC-03       | [Coverage and limits](#ac-03) |
| AC-04       | [Coverage and limits](#ac-04) |
| AC-05       | [Coverage and limits](#ac-05) |
| AC-06       | [Coverage and limits](#ac-06) |
| AC-07       | [Coverage and limits](#ac-07) |
| AC-08       | [Coverage and limits](#ac-08) |
| AC-09       | [Coverage and limits](#ac-09) |
| AC-10       | [Coverage and limits](#ac-10) |
| AC-11       | [Coverage and limits](#ac-11) |
| AC-12       | [Coverage and limits](#ac-12) |
| AC-13       | [Coverage and limits](#ac-13) |
| AC-14       | [Coverage and limits](#ac-14) |
| AC-15       | [Coverage and limits](#ac-15) |
| AC-16       | [Coverage and limits](#ac-16) |

### AC-01

- **Positive / negative acceptance:** Durable start row; no client/body identity creates mode.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “starts, rejects nesting, stops and preserves idle revisions”; `tests/core_authorization.spec.ts` — “incarnation and namespace isolate rows and no-row contexts; client actor substitution rejected”; `tests/lucid_control_store.spec.ts` — “independent connections race absent and existing owner with exactly one audit event per winner”.

### AC-02

- **Positive / negative acceptance:** All valid devices see target; native actor remains raw; effective facade target.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/effective_guard.spec.ts` — “facade, raw actor, Bouncer and silent_auth retain their identities across start and stop”; `tests/core_service.spec.ts` — “two devices starting at the same context produce one winner and no fallback”. Real separate-session continuity is covered by `examples/native-session/tests/functional/masquerade_context.spec.ts` — “logout ends only the actor session that submitted it”.

### AC-03

- **Positive / negative acceptance:** Target Bouncer, actor separately accessible, no union.
- **Current concrete evidence / remaining gap:** `examples/native-session/tests/functional/effective_guard.spec.ts` — “facade, raw actor, Bouncer and silent_auth retain their identities across start and stop”; plus `examples/native-session/tests/functional/masquerade_context.spec.ts` — “does not mint target credentials and never unions actor Bouncer access”.

### AC-04

- **Positive / negative acceptance:** Missing/false/throw callback leaves state unchanged.
- **Current concrete evidence / remaining gap:** `tests/core_authorization.spec.ts` — “start denies false and truthy nonboolean policy; policy throws unavailable; no revision change”; `tests/define_config.spec.ts` — “validates config synchronously and freezes copied configuration”.

### AC-05

- **Positive / negative acceptance:** No nesting mutation; same expected revision one winner; next current revision can proceed.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “starts, rejects nesting, stops and preserves idle revisions”; “stale start and stop cannot overwrite or clear the current winner”; “two devices starting at the same context produce one winner and no fallback”; `tests/lucid_control_store.spec.ts` — “independent connections race absent and existing owner with exactly one audit event per winner”.

### AC-06

- **Positive / negative acceptance:** Stop by actor control credential without start permission or target auth.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “stop ignores target deletion, denied policies and failing stamp access”; real cookie `examples/native-session/tests/functional/masquerade_context.spec.ts` — “logout ends only the actor session that submitted it” exercises the other valid actor session after logout.

### AC-07

- **Positive / negative acceptance:** Logout one device preserves mode; stop/expiry clear.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “starts, rejects nesting, stops and preserves idle revisions”; `tests/core_admission.spec.ts` — “exact expiry clears durably without stamp access and rejects the triggering request”. Fixture case “logout ends only the actor session that submitted it” proves the surviving session; docs in [security guide](../guide/security.md).

### AC-08

- **Positive / negative acceptance:** Revoked credential denied; epoch change clears.
- **Current concrete evidence / remaining gap:** `tests/core_admission.spec.ts` — “credential and local denial preserve mode; native rejection writes no package event”; “global invalidity ${invalidation} clears once and never admits the triggering request”; real-cookie fixture “logout ends only the actor session that submitted it” advances actor stamp and checks 409 then idle. The real-cookie fixture creates two distinct actor cookies plus a target cookie, confirms the second actor session continues to see shared mode after the first logs out, then changes the actor stamp to prove a safe-request 409 followed by idle identity. `examples/native-session/tests/credentials/native_credentials.spec.ts` — “recovers the raw actor through remember-me after native session expiry while the effective guard keeps the admitted target” additionally proves an expired non-remembered credential cannot read status, access raw/effective business routes, start or stop, and leaves the mode row/event count unchanged. Starting mode preserves the native session and remember cookie; remember-me recovery after native session expiry creates a new session and rotates the remember cookie, then status/stop/start/stop succeed. Target token count remains zero.

### AC-09

- **Positive / negative acceptance:** Global target invalidity clears/rejects; tenant local rejects without revision change; exception fails closed.
- **Current concrete evidence / remaining gap:** `tests/core_admission.spec.ts` — “global invalidity ${invalidation} clears once and never admits the triggering request”; `tests/core_authorization.spec.ts` — “start policy receives reason/request and admission policy gets neither; local tenant denial preserves revision”; `tests/core_failures.spec.ts` — “authority and local-policy throws preserve mode without admitting or logging secrets”; `examples/native-session/tests/functional/masquerade_context.spec.ts` — “applies the host operator policy when starting from an idle actor context”.

### AC-10

- **Positive / negative acceptance:** Expiry/stale context rejects trigger, no identity fallback, next request current.
- **Current concrete evidence / remaining gap:** `tests/core_admission.spec.ts` — “exact expiry clears durably without stamp access and rejects the triggering request”; `tests/http_context_middleware.spec.ts` — “context token errors take precedence over the access rule”; `tests/effective_session_guard.spec.ts` — “business guard owns the facade while the raw guard retains actor identity; failures never fall back”. The real-cookie fixture case “logout ends only the actor session that submitted it” verifies stamp invalidation on a safe GET (409), then idle actor identity on the following GET.

### AC-11

- **Positive / negative acceptance:** Idle/active unsafe token; mode revisions stale token; control/raw routes cannot become target business handlers.
- **Current concrete evidence / remaining gap:** `tests/context_token.spec.ts` — “A to idle to A rotates nonce and never revives old tokens”; `tests/http_context_middleware.spec.ts` — “skips explicit raw-guard routes without reading masquerade state”; fixture owner/header/form cases cited for FR-14.

### AC-12

- **Positive / negative acceptance:** View-mode unsafe actions deny; edit-mode ordinary mutations require accepted `canEdit`, `allowMutation()`, target authorization, and current context; sensitive/billing actions always deny with structured `blockedBy`.
- **Current concrete evidence / remaining gap:** [Security and operations](../guide/security.md#authorization-and-route-coverage), [JSON client](../guide/clients/json.md), [Vue integration](../guide/clients/vue.md), and [React integration](../guide/clients/react.md) document the blocked-action values and host handling. The [walkthrough](../guide/walkthrough.md#try-the-support-journey) shows edit selected at start. #87 includes `tests/core_admission.spec.ts` edit-denial invalidation coverage and `tests/core_service.spec.ts` — “started, stopped and invalidated events carry the row’s access; observer payloads include it”; #90 includes “sensitive blocks every method in both levels”, “context token errors take precedence over the access rule”, and “edit mode with allowMutation reaches the handler under the target” in `tests/http_context_middleware.spec.ts`. Implemented and verified in the SQLite and PostgreSQL root suites for this batch; delivery remains pending PR merge.

### AC-13

- **Positive / negative acceptance:** Audit payload complete/minimized; admitted denials/noops; business/status denial outside package audit.
- **Current concrete evidence / remaining gap:** `tests/core_service.spec.ts` — “start persists bounded reason and hashes; projections and observers expose only safe fields”; “matching idle stop records a noop and never rotates the context”; `tests/http_controllers.spec.ts` — “routes malformed control input through core auditing and renders the public error”; `tests/lucid_control_store.spec.ts` — “audit payload survives storage and duplicate event failures roll back insert and update”. The Lucid case deep-compares all persisted event columns (ID, mode/owner keys, target identity, timestamp, kind, outcome, revision and reason); the core case checks normalized reason persistence and that projections/observer output omit reason and sensitive fields. The settled success-only reason rule is recorded below.

### AC-14

- **Positive / negative acceptance:** Required store failure blocks transition; observers never misreport/hang.
- **Current concrete evidence / remaining gap:** `tests/core_failures.spec.ts` — “CAS write and required outcome failures return 503 and leave authoritative state unchanged”; “observer sync throws, rejected promises and rejected reporter cannot alter a committed result”; “never-settling observers are not awaited”; `tests/http_controllers.spec.ts` — “returns unavailable when recording an invalid-control audit fails”.

### AC-15

- **Positive / negative acceptance:** Core import remains free of optional Lucid and Account Kit dependencies; the accepted v1.2 Account Kit adapter issues no target credential and respects the separate subpath boundary.
- **Current concrete evidence / remaining gap:** `tests/package_exports.spec.ts` — “imports the core without resolving optional integrations”; the packed Account Kit credentials and journey suites prove no target credential issuance. Full Account Kit evidence is recorded below.

### AC-16

- **Positive / negative acceptance:** Docs explain session transport/CSRF/context/routes/logout/side effects.
- **Current concrete evidence / remaining gap:** Documented in [setup](../guide/setup.md) and [security and operations](../guide/security.md). `tests/docs_links.spec.ts` checks link paths/anchors only; it does not establish content adequacy.

## M4 evidence and optional verification

- **Configure command (complete):** six focused cases pass: four in `tests/configure.spec.ts` and one in `tests/configure_ace.spec.ts` — “loads and executes the package hook through native Ace”; “generates fail-closed files and additive wiring, skips existing files, and force replaces them”; “prompts for missing values and rejects unsafe namespace before touching files”; “fails closed when Auth config or Lucid is unavailable” (including missing assembler preflight); and “returns failure when native registration reports a codemod error” — plus `tests/lucid_schema.spec.ts` — “migration stub respects Lucid dry-run, creates once and rolls back both tables”. Three configure mutants (overwrite behavior, provider registration, middleware registration) and three packed-harness mutants (floor-selection mismatch, optional Lucid runtime import from package root, missing configure export) were killed. Packed floor and latest configure generated config, native provider, user provider, class middleware and migration compile against real default User/UserSchema/app aliases and host augmentations in each profile. `tests/package_exports.spec.ts` — “imports the core without resolving optional integrations” covers the root boundary.
- **Packed consumer (complete):** `bin/test_consumer.ts` ran frozen artifact SHA-256 `60228e9878167652a690b42a17a8a4d37d72fa9b8b6b4f72354a4de23f0c27a9` on Node 24.21.0 in all four cells: floor and latest on SQLite and PostgreSQL 16.15. Both profiles passed generated Ace configure, all five generated files compiling against real default User/UserSchema, the fresh-root-process probe rejecting all `@adonisjs` and Account Kit runtime imports, lint and build. Each database cell passed typecheck, 16 functional cases, one report case and one expanded credential case (18 each, 72 total). Each profile passed 59 installed peer checks with zero incompatible peer warnings. Actual versions: floor Core 7.0.0, Auth 10.0.0, Bouncer 4.0.0, Lucid 22.4.2, Session 8.1.0, TypeScript 5.9.3; latest Core 7.6.0, Auth 10.1.0, Bouncer 4.0.1, Lucid 22.4.2, Session 8.3.0, TypeScript 6.0.3. Both use assembler 8.5.2, Japa Adonis plugin 5.2.0 and Japa runner 5.3.0; Vite integration is 6.0.1 at floor and 6.0.2 at latest because 6.0.2 requires Core 7.5. Alternate-user coverage composes a raw native provider, core/service and SQL for string/UUID identifiers in `support_accounts.account_key` (no `id` column); it does not claim a second independent effective-guard facade. The existing numeric-user fixture retains its 14 real HTTP cases.
- **Cross-device logout:** real two-cookie continuity and stamp invalidation are proven by `examples/native-session/tests/functional/masquerade_context.spec.ts` — “logout ends only the actor session that submitted it”; this is evidence for FR-12/13/23 and AC-07/08.
- **Billing:** settled convention is that the host marks billing and other sensitive routes with `sensitive()`. The package does not infer semantics from route names or URLs. The fixture's billing case combines `allowMutation()` and `sensitive()` to prove the sensitive marker wins.
- **Audit reason (settled):** successful start events store the normalized reason. Denied starts and invalid control attempts omit reason, including raw rejected input. Stop has no reason. This follows the M1 privacy decision; `tests/core_authorization.spec.ts` case “duration boundaries, host narrowing and invalid input audit do not leak rejected reason” and `tests/core_service.spec.ts` case “start persists bounded reason and hashes; projections and observers expose only safe fields” are evidence.
- **Actor eligibility/stop (settled):** any valid native actor session may stop despite actor stamp/eligibility, target eligibility, or policy changes. Stop reads only owner mode/context; it does no target, stamp, or policy read. Invalid native credential is denied by session auth. Evidence: `tests/core_service.spec.ts` — “stop ignores target deletion, denied policies and failing stamp access”; fixture outage and cookie cases confirm raw session authentication and control paths.
- **M3 gate:** M3 is marked pass in [M3-RESULT.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/7e0940e/M3-RESULT.md): 14 real app cases (4 M0 + 10 M3), one report-mode case, route output, and the listed SQLite/PostgreSQL/build/export checks. This does not satisfy the separate M4 floor/latest packed consumer matrix.
- **M4 final status:** every retained FR-01–31, NFR-01–08 and AC-01–16 maps to concrete test and documentation evidence; deferred clauses are identified above. Root checks, six configure/migration tests, generated-scaffold compiles, credential path case, and all four packed consumer cells pass. Six configure and packed-harness mutants were killed; the remembered-feature-off mutant fails at initial login (limiting that negative branch), and a 10-second TTL mutant is rejected at exact expiry. The optional process-restart and combined host-CSRF/limiter event-count probes are not acceptance gaps. M4 verification is complete; publication, tagging and merging are outside this evidence record.

## V1.1 opaque access-token acceptance (T-TOKEN)

The preceding ledger records the accepted v1 contract and M4 evidence. The additive v1.1 contract
is in [section 13 of the technical specification](design/spec-masquerade.md#13-v11-additive-contract-opaque-access-tokens).

| Acceptance obligation                                                   | Evidence                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Authenticate only through the named native token guard,…                | [Coverage and limits](#native-guard-authentication)                                     |
| Keep the exact primary authority, freeze the guard…                     | [Coverage and limits](#primary-authority-and-guard-composition)                         |
| Preserve effective user typing and use the explicitly…                  | [Coverage and limits](#effective-user-typing-and-token-identity)                        |
| Select only registered Auth guards, reject ambiguous routes,…           | [Coverage and limits](#registered-guard-selection)                                      |
| Exercise real token status, start, effective reads and…                 | [Coverage and limits](#native-token-http-journey)                                       |
| Share one mode and context across session and…                          | [Coverage and limits](#shared-session-and-token-context)                                |
| Require ability before integrated operations, retain raw actor…         | [Coverage and limits](#token-ability-and-bearer-precedence)                             |
| Allow stop despite policy denial, deleted target, or…                   | [Coverage and limits](#stop-recovery-and-stamp-changes)                                 |
| Enforce context owner, missing-context 428, and stale-context 409.      | [Coverage and limits](#enforce-context-owner-missing-context-428-and-stale-context-409) |
| Boot token-only Auth with the effective token guard…                    | [Coverage and limits](#token-only-default-guard)                                        |
| Keep Auth token lifecycle native, raw auth/security/logout store-free,… | [Coverage and limits](#native-lifecycle-and-csrf-boundaries)                            |

### Native guard authentication

- **Acceptance obligation:** Authenticate only through the named native token guard, preserve native unauthorized behavior, map canonical identity, and deny missing ability before package lookup.
- **Test references:** `tests/access_tokens_authority.spec.ts`: “access token authority authenticates its named guard, enforces ability, and maps canonical identity”; “access token authority denies a missing ability before provider lookup”; “access token authority preserves native 401 and sanitizes other native and provider failures”; “access token authority rejects non-access-token guards before authentication”; “access token authority shares the exact supplied authority and validates options”.

### Primary authority and guard composition

- **Acceptance obligation:** Keep the exact primary authority, freeze the guard map, and reject mismatched, duplicate, nested, or malformed compositions.
- **Test references:** `tests/native_authorities.spec.ts`: “native authorities retain the primary authority and freeze adapters by effective raw guard”; “native authorities reject a different authority object, even with matching fields”; “native authorities reject duplicate and malformed effective guards”; “native authorities preserve method receivers and reject nested compositions”; “native authorities preserve the primary authority and actor user types”.

### Effective user typing and token identity

- **Acceptance obligation:** Preserve effective user typing and use the explicitly selected token actor with correct `silent_auth`, never an incidental cookie.
- **Test references:** `tests/effective_access_tokens_guard.spec.ts`: “effective token factory preserves nominal users without inferring actor token metadata”; “default effective token facade uses selected token actor and target, never cookie actor”; “default silent auth on an explicit raw api route chooses api, not cookie”. `tests/runtime_guard_configuration.spec.ts`: “runtime service uses route-selected token actor despite a conflicting cookie actor”.

### Registered guard selection

- **Acceptance obligation:** Select only registered Auth guards, reject ambiguous routes, require adapters for effective factories, and avoid primary-adapter fallback for registered raw guards without an adapter.
- **Test references:** `tests/route_guard_selection.spec.ts`: “route selection resolves same-raw effective aliases and raw token controls”; “route selection rejects mixed, ambiguous and unknown explicit guards”. `tests/runtime_guard_configuration.spec.ts`: “runtime accepts one authority across raw guards and maps every effective factory”; “runtime rejects missing raw or unmapped effective factories at configuration”; “unrelated registered raw guard passes selection but cannot enter the service” checks unavailable before store read and no fallback.

### Native token HTTP journey

- **Acceptance obligation:** Exercise real token status, start, effective reads and Bouncer, allowed mutation, sensitive denial, stop, and unchanged native token count and expiry.
- **Test references:** `examples/native-session/tests/functional/access_token_authority.spec.ts`: “uses an opaque token for idle, status, start, effective reads, mutation and stop”.

### Shared session and token context

- **Acceptance obligation:** Share one mode and context across session and token transports; serialize competing starts; preserve the mode when one token is revoked.
- **Test references:** `examples/native-session/tests/functional/access_token_authority.spec.ts`: “shares account mode with sessions in both directions”; “serializes concurrent session and token starts from one idle context”; “preserves an active account mode when its token is revoked”.

### Token ability and bearer precedence

- **Acceptance obligation:** Require ability before integrated operations, retain raw actor routes, enforce native invalid-token behavior, select bearer identity despite cookie conflicts, and preserve native wildcard semantics.
- **Test references:** `examples/native-session/tests/functional/access_token_authority.spec.ts`: “requires the configured ability before touching account mode while raw token routes remain actor routes”; “keeps native 401 behavior for malformed, revoked and expired credentials without cookie fallback”; “uses the explicitly selected bearer actor when cookie and bearer actors conflict”; “accepts native wildcard ability semantics”.

### Stop recovery and stamp changes

- **Acceptance obligation:** Allow stop despite policy denial, deleted target, or changed/failing stamps and policies; invalidate token admission after account stamp changes.
- **Test references:** `examples/native-session/tests/functional/access_token_authority.spec.ts`: “allows token stop after policy denial, target deletion and actor stamp change”; “stops with a token while authority stamp and policy callbacks throw”; “invalidates token admission after the actor security stamp changes”.

### Enforce context owner, missing-context 428, and stale-context 409

- **Test references:** `examples/native-session/tests/functional/access_token_authority.spec.ts`: “enforces token context ownership and missing or stale mutation context”.

### Token-only default guard

- **Acceptance obligation:** Boot token-only Auth with the effective token guard as default and complete an HTTP lifecycle.
- **Test references:** `examples/native-session/tests/token-only/token_only_boot.spec.ts`: “boots with the token guard as default and completes a real HTTP journey”.

### Native lifecycle and CSRF boundaries

- **Acceptance obligation:** Keep Auth token lifecycle native, raw auth/security/logout store-free, bearer-only CSRF policy explicit, and session CSRF behavior intact.
- **Test references:** Native lifecycle and raw route behavior are covered in `examples/native-session/tests/functional/access_token_authority.spec.ts`; transport boundaries are documented in the [access-token guide](../guide/access-tokens.md), [security guide](../guide/security.md), and [T-TOKEN specification](design/spec-masquerade.md#134-t-token-acceptance-family).

**Validation status:** Node 24.21.0 and pnpm 11.23.0 were used. `pnpm lint`, `pnpm build`,
`pnpm typecheck`, `pnpm quick:test` (202 passed, 1 built-only case skipped),
`pnpm test:built-exports` (7 passed, including the Ace case excluded from `quick:test`), and
`pnpm docs:build` passed.
`pnpm test:pg` passed on PostgreSQL 16.15 (198 passed, 1 built-only case skipped), and the
managed server stopped cleanly. The separate built-export gate covers the built-only Ace case.

**Packed consumer matrix:** `pnpm test:consumer` passed all four floor/latest × SQLite/PostgreSQL
16.15 cells on Node 24.21.0 and pnpm 11.23.0; PostgreSQL stopped cleanly. Artifact SHA-256:
`74ede209cca970f57151d4d4fd65263270fbd647dfe2936462dba20549dc9ee5`. Each SQLite cell passed 51
functional, 1 token-only, 2 report, and 1 credential case (55 total). Each PostgreSQL cell passed
47 functional, 1 token-only, 2 report, and 1 credential case; four SQLite-only demo-account
functional cases were skipped per PostgreSQL cell (51 passed, 4 skipped). Across the matrix, 212
cases passed; no T-TOKEN case was skipped. Both profiles passed configure, lint, build, typecheck,
and the root optional-import probe; each passed 62 peer checks with zero warnings. Dependency
versions (Core/Auth/Bouncer/Lucid/Session/TypeScript): floor 7.0.0/10.0.0/4.0.0/22.4.2/8.1.0/5.9.3;
latest 7.6.0/10.1.0/4.0.1/22.4.2/8.3.0/6.0.3.

## V1.2 Account Kit acceptance (T-KIT and T-KIT-HTTP)

**Matrix status:** The optional peer now declares scoped `@kevinjohn/adonisjs-account-kit` `0.3.3` only.
The `0.3.3` compatibility matrix runs in the update pull request; the `compat` workflow runs on
every pull request that changes `package.json`. The `0.3.1` pin passed all 16 floor/latest cells
against its GitHub release artifact in the
hosted `compat` workflow ([run 42310704826](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/runs/42310704826))
on 6 November 2026 at `d31bf7df0319c514a72f451df102b237fd4c8b69`. The scoped `0.3.0` passed all
16 cells in the hosted `compat` workflow ([run 42168861107](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/runs/42168861107))
on 6 November 2026 at `ac627ce77bfc1e1746c286ce5dd3427b655f39e2`. The scoped `0.2.0` passed all
16 cells in the hosted `compat` workflow ([run 41731431285](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/runs/41731431285))
on 3 November 2026 at `f40d95a9eecdc68fbcdc0c039fb23a8dae6b0f39`. The scoped `0.1.5` passed the same
cells in [run 41642918567](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/runs/41642918567)
on 3 November 2026 at `c12e91801ba50927f54ddd1fb9d5eb314aa759fd`. The unscoped `0.1.4` evidence is in
[Account Kit 0.1.4 matrix](#account-kit-014-matrix--3-november-2026); the 27 October 2026 evidence
covers `0.1.3`, and the 22 October 2026 evidence covers `0.1.1`; none of these versions is declared
any longer.

The owner accepted D1–D13 on 22 October 2026. The technical contract is
[SPEC §15](design/spec-masquerade.md#15-v12-account-kit-integration), and the product boundary is
the [PRD v1.2 addendum](design/prd-masquerade.md#v12-account-kit-integration-accepted-22-october-2026).
The six deliverables are implemented in open, unmerged PRs #100–#105 for issues #94–#99.
The authority, blocker, consumer and documentation PRs remain drafts. Independent reviews are
complete with reported findings resolved.

Account Kit `0.3.3` adds `admission.record` and changes nothing Masquerade uses. Scoped Account
Kit `0.3.3` is pinned to the GitHub release artifact with SHA-256
`38361949f135aeae18d92aee207754bacb8b6ef66436f96d523ddaf30a11bac0`, built from source commit
`78a360b21e7540ab52562402e6fa9c085a52a0d8` (tag `v0.3.3`). The previous `0.3.2` artifact had
SHA-256 `82033c9acd74595b93abc3a8b85f66b5f7cd4da54c07d3a25a55a38308724b48`, from commit
`623f562ba27d5e52ae91cc6e515b646276c16a5f`; it updated example schemas and vendor comments
without changing package code. The `0.3.1` artifact had
SHA-256 `87a28f6756869f933827edbc00dbd8a37253cacad8d7ed823566cebd83fb7a9f`, from commit
`52b32cef0b80e760d03b984b2391444d3f04d3f2`; its dated matrix results above remain historical evidence.

The previous pin, scoped Account Kit `0.3.0`, had SHA-256
`c94ef9254abf27ba9565b74af05c98509fdfd8ffcd7e08fe30efe131898a9fcb`, built from source commit
`b798a5beb796641f2312b318dd56f16271a2d06e` (tag `v0.3.0`). It added scoped invitations and the
`/transaction` export, and left `ctx.auth.user` set after the managed and admission middleware.
Masquerade runtime code did not change for that pin.

The previous pin, scoped Account Kit `0.2.0`, had SHA-256
`3c25f5888c2d0f7fd1a0a987e2c84e489e8cfd3ba19e97f1aa117b52371a461d`, built from source commit
`81949782d87b426d3b094ac2cb45f08722697fe4` (tag `v0.2.0`). It carried the Account Kit
code-standardisation changes. The error classes Masquerade reads, `AccountAccessDeniedError` and
`InvalidSessionError`, kept their names and codes; Masquerade runtime code did not change for that pin.

The previous pin, scoped Account Kit `0.1.5`, had SHA-256
`1efdb5bcda9aeb1dd78e71293d1af0471335cb44e25661ea58dc26540e8a69d5`, built from source commit
`4aebc86950139b5ad173e67e21da01b53135bc86` (tag `v0.1.5`). It renamed the package to
`@kevinjohn/adonisjs-account-kit`; Masquerade changed only its import specifiers for that pin.

The previous pin, unscoped Account Kit `0.1.4`, had SHA-256
`5fa51b3f892d03e9f4e4776c40a33bc1eff2e4e884e4e6d2f528bbf99ef44d6b`, built from source commit
`fae423198ae2d591cdf3bc89ee1b3e47258dfb99` (tag `v0.1.4`). Its release notes report no new
migrations or config changes from `0.1.3`; it changes `configure` provider detection, reloads the
actor inside invitation resend/revoke authorization, and fixes reference examples and docs.
Masquerade runtime code did not change for this pin.

The previous pin, Account Kit `0.1.1`, had SHA-256
`38fd950b08990a95b780d3077ad65f3a98bb898cb858b7b2f9eaabaae236a3d2` and source commit
`b1ae0d48fda29ff75a2edc9f021c61eff3b1267b`. That release fixed the Core `7.0.0` Ace-startup import
failure described in the [historical compatibility brief](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/0adbe49/docs/maintainers/account-kit-core-floor-feedback.md).
The initial matrix attempt reached all eight latest cells but stopped in the floor cells because
the runner invoked an unsupported `codegen` Ace command at Core `7.0.0`; the corrected harness
treated that command as unsupported and all eight floor cells passed. Public registry publication
is not a prerequisite for this GitHub-artifact integration evidence.

| Decision range | Evidence                                        |
| -------------- | ----------------------------------------------- |
| D1–D3          | [Coverage and limits](#capabilities-d1-to-d3)   |
| D4–D5          | [Coverage and limits](#capabilities-d4-to-d5)   |
| D6–D8          | [Coverage and limits](#capabilities-d6-to-d8)   |
| D9, D12        | [Coverage and limits](#d9-d12)                  |
| D10–D11        | [Coverage and limits](#capabilities-d10-to-d11) |
| D13            | [Coverage and limits](#d13)                     |

### Capabilities D1 to D3

- **Implementation and evidence:** Lazy optional subpaths, coherent active snapshot, captured equality-only revision stamp, native provider identity and denial/error mapping are implemented. The optional peer is pinned to the GitHub release in the matrix status above; authority/service tests and all 16 floor/latest packed cells pass.

### Capabilities D4 to D5

- **Implementation and evidence:** Raw credential plus Kit current validation and separate host-owned actor/target admission pass in the real HTTP credential and admission suites.

### Capabilities D6 to D8

- **Implementation and evidence:** Global managed-route blocker, exemptions, store outage, mounted-method/custom-prefix coverage and verified route-report classifications pass in provider/blocker tests and the packed routes suite.

### D9, D12

- **Implementation and evidence:** SQLite and PostgreSQL pass with both strategies and session management on/off at floor and latest peers. Each host configures one transport. MySQL and a second composed transport remain outside scope.

### Capabilities D10 to D11

- **Implementation and evidence:** Contract pointers and the existing service's symbol-keyed validated row accessor are implemented; no second store or mode mutation is introduced. Accessor and HTTP tests cover active, expired, absent, malformed and unavailable rows.

### D13

- **Implementation and evidence:** Provider guard identity/strategy, committed registration and actual blocker installation are verified. Console readiness explicitly commits routes; lifecycle/provider regressions and packed route reports pass.

**T-KIT obligations:** prove null and timestamp revisions encode differently and start stores the
inspection snapshot's stamp. Missing, restricted and inactive targets are indistinguishable 403s
at start; changed target eligibility produces `target_ineligible` on admission. Inspection
operational failures, including post-commit and uncomparable-ID database errors, return 503 and
leave mode unchanged. Eligible target revision changes from password change, `sessions.revokeAll`
or restriction change produce `target_stamp`. Actor password change with `keepCurrent` produces
`actor_stamp` on the next admission without 401; actor `revokeAll` or password change without
`keepCurrent` produces 401 until re-login, then `actor_stamp`; restriction denying `canAccess`
produces 401 while restricted. Single revoke, revoke-others and logout do not invalidate mode.
With a pre-context host gate using `AccountAdmission.require` on protected control/business routes
and `AccountAdmission.isAdmitted` in target policy, target admission revocation produces
`policy_denied`; actor admission revocation returns 403 before the mode row is read and leaves it
unchanged until re-approval. A stale session revision, revoked token or ended session handle cannot start, use or stop and is
rejected before a store read. Inspection creates no target credential, session, token or revision
change. Cover both strategies, session management on/off, incarnation callback and guard
name/strategy mismatch at startup.

**T-KIT-HTTP obligations:** every mounted registered managed route other than logout and CSRF is
blocked before its handler during active mode, for every method and custom prefix. With Account
Kit's `except` option, omitted endpoints are not mounted by Account Kit and remaining registered
routes stay covered by the blocker. A host-added `accountKit.*` route absent from registration fails
provider validation. Tokens without the Masquerade ability remain
blocked. Logout, CSRF and unauthenticated public managed requests pass without a Masquerade store
read. Every
other authenticated managed request reads the actor's mode row; an active unexpired mode is
blocked, while no row, an idle or expired row, or no active mode for that actor passes after the
read. Authenticated managed requests with Masquerade store outage return 503, except logout and CSRF, which
pass store-free. Missing managed registration fails at startup in both the HTTP and console
lifecycles. The route report lists the managed group only when blocker installation is verified, and
otherwise leaves routes unclassified with a missing or unverified note. `node ace` works without
Account Kit.

| Acceptance family              | Evidence                                               |
| ------------------------------ | ------------------------------------------------------ |
| T-KIT                          | [Coverage and limits](#t-kit)                          |
| T-KIT-HTTP                     | [Coverage and limits](#t-kit-http)                     |
| GitHub release artifact matrix | [Coverage and limits](#github-release-artifact-matrix) |

### T-KIT

- **Verified evidence and remaining boundary:** Floor/latest packed credential, eligibility, admission and journey suites pass on both databases/strategies and management settings. `tests/account_kit_authority.spec.ts` and `tests/account_kit_service.spec.ts` cover stamp capture/null encoding, incarnation callback and controlled operational-error propagation. Real host tests exercise SQLite revision-read and PostgreSQL incomparable-ID SQL failures. Post-commit failure mapping uses controlled error injection; an actual Account Kit post-commit hook failure was not induced.

### T-KIT-HTTP

- **Verified evidence and remaining boundary:** Floor/latest packed routes/journey suites and root blocker/provider/lifecycle tests pass, including all mounted methods, custom prefix/omissions, no-ability token blocking, canonical owner isolation, store-free exceptions, outage behavior and missing installation/registration.

### GitHub release artifact matrix

- **Verified evidence and remaining boundary:** Passed: exact release pin and SHA verified; floor and latest each pass on SQLite/PostgreSQL with session and access-token strategies and session management on/off. Public registry publication is a separate release step, not an acceptance gate.

### Account Kit 0.1.4 matrix — 3 November 2026

The runner downloaded Account Kit `0.1.4` from its GitHub release, verified SHA-256
`5fa51b3f892d03e9f4e4776c40a33bc1eff2e4e884e4e6d2f528bbf99ef44d6b` and the packed
`package.json` version, and packed Masquerade `0.1.3-alpha` from the candidate branch with the
`0.1.4` peer declaration. The tested Masquerade archive SHA-256 is
`268bf8e6090a91978f06ca654972b71ec96942ae67310f33b8cc0abb0f41e0bd`. Node was `24.22.1`, pnpm
`11.23.0`, and PostgreSQL `16.15` ran natively. Floor resolved Core `7.0.0`, Auth `10.0.0`,
Session `8.1.0`, Bouncer `4.0.0`, Lucid `22.4.2` and TypeScript `5.9.3`; latest resolved Core
`7.6.0`, Auth `10.1.0`, Session `8.3.0`, Bouncer `4.0.1`, Lucid `22.4.2` and TypeScript `6.0.3`.

| Database | Strategy      | Session management | Floor passed/skipped | Latest passed/skipped |
| -------- | ------------- | ------------------ | -------------------- | --------------------- |
| sqlite   | session       | on                 | 22 / 2               | 22 / 2                |
| sqlite   | session       | off                | 17 / 7               | 17 / 7                |
| sqlite   | access_tokens | on                 | 22 / 2               | 22 / 2                |
| sqlite   | access_tokens | off                | 18 / 6               | 18 / 6                |
| pg       | session       | on                 | 21 / 3               | 21 / 3                |
| pg       | session       | off                | 16 / 8               | 16 / 8                |
| pg       | access_tokens | on                 | 21 / 3               | 21 / 3                |
| pg       | access_tokens | off                | 17 / 7               | 17 / 7                |

The counts match the `0.1.3` run. Floor records `codegen` as unsupported at Core `7.0.0`;
configure, migration, typecheck, route report and all six suites passed in every cell.

### Account Kit 0.1.3 matrix — 27 October 2026

The runner downloaded Account Kit `0.1.3` from its GitHub release, verified SHA-256
`1ca53538256c360cb87ddbadfaf00f2364a453fea349f6bb8757e58756ed9e7f` and the packed
`package.json` version, and packed Masquerade `0.1.0-alpha.1` from the candidate branch with the
`0.1.3` peer declaration. The tested Masquerade archive SHA-256 is
`008869abea526cb532a81043bd7e823db3c18049c81f1e69aa222d1a5de791b1`; a tar comparison confirmed
that the committed candidate's packed payload differs from it only in the `CHANGELOG.md` entry.
Node was `24.22.1`, pnpm `11.23.0`, and PostgreSQL `16.15` ran natively. Floor and latest resolved
the same peer versions as the 22 October run. Each cell installed its own packed host and ran the
six Account Kit integration specs in a fresh Ace process.

| Database | Strategy      | Session management | Floor passed/skipped | Latest passed/skipped |
| -------- | ------------- | ------------------ | -------------------- | --------------------- |
| sqlite   | session       | on                 | 22 / 2               | 22 / 2                |
| sqlite   | session       | off                | 17 / 7               | 17 / 7                |
| sqlite   | access_tokens | on                 | 22 / 2               | 22 / 2                |
| sqlite   | access_tokens | off                | 18 / 6               | 18 / 6                |
| pg       | session       | on                 | 21 / 3               | 21 / 3                |
| pg       | session       | off                | 16 / 8               | 16 / 8                |
| pg       | access_tokens | on                 | 21 / 3               | 21 / 3                |
| pg       | access_tokens | off                | 17 / 7               | 17 / 7                |

Each profile passed 154 cases with 38 expected configuration-specific skips, the same counts as the
`0.1.1` run. Floor records `codegen` as unsupported at Core `7.0.0`; configure, migration,
typecheck, route report and all six suites passed in every cell. The SQLite + session + session
management on cell is the configuration CapacityLens uses.

The guide session snippets were then rechecked in a separate disposable host with Account Kit
`0.1.3` and the committed candidate's Masquerade archive, SHA-256
`48363200a49f2243529dfa32244c2f46c135921f52b48f4fd7d2ab880c017442`. The host was a copy of the
latest SQLite session cell (Core `7.6.0`, Auth `10.1.0`, Session `8.3.0`) with session management
on. These files were taken verbatim from the guide: `app/services/account_kit_guard.ts`,
`config/masquerade.ts`, `providers/masquerade_native_provider.ts`,
`app/middleware/account_kit_actor_admission_middleware.ts`, the `adonisrc.ts` provider order and
the kernel middleware order. `app/services/masquerade_user_provider.ts` came from the configure
stub, and the raw web guard imported it as the setup guide shows. The protected `/business` route
was named `business.customers`. Migration, `node ace masquerade:routes` (18 verified managed
routes) and `tsc --noEmit` passed. The packed journey spec passed (1 case) and the admission spec
passed (3 cases) with `access: 'view'`, because the guide's policy defines no `canEdit`. Removing
the `business.customers` name made the revoked-actor admission case fail with 200 instead of 403.
This verifies the documented session wiring and runtime path; it is not a usability study.

### Pinned GitHub release artifact matrix — 22 October 2026

The runner downloaded and SHA-256 verified Account Kit `0.1.1` from its GitHub release and packed
Masquerade artifact `060dbe029e58dcf7126d92d55328ae46c8cf26c9d5ce017db7a717ab53d57d06`. Both the
initial all-profile run and corrected floor run used identical Masquerade and Account Kit archive
hashes. Node was `24.21.0`, pnpm `11.23.0`, and PostgreSQL was `16.15`. Each cell installed its own
packed host and ran the six selected Account Kit integration specs in a fresh Ace process.

The final Masquerade candidate adds `@vinejs/vine` `^4.4.0` as a development dependency for the
Account Kit HTTP peer. Its packed artifact is SHA-256
`8a12fb0ecc7a198a239e6cee2cdaf715b78564a68e39938e6cb4a846555809b1`; a tar comparison confirmed
that its only payload difference from the matrix-tested `060dbe...` archive is the `package.json`
development-dependency entry. The matrix below is direct runtime evidence for `060dbe...`; the
manifest-only difference does not change its built runtime files. The guide names the host-provided
Vine dependency requirement.

| Dependency | Floor  | Latest |
| ---------- | ------ | ------ |
| Core       | 7.0.0  | 7.6.0  |
| Auth       | 10.0.0 | 10.1.0 |
| Lucid      | 22.4.2 | 22.4.2 |
| Session    | 8.1.0  | 8.3.0  |
| Bouncer    | 4.0.0  | 4.0.1  |
| TypeScript | 5.9.3  | 6.0.3  |

| Database | Strategy      | Session management | Floor passed/skipped | Latest passed/skipped |
| -------- | ------------- | ------------------ | -------------------- | --------------------- |
| sqlite   | session       | on                 | 22 / 2               | 22 / 2                |
| sqlite   | session       | off                | 17 / 7               | 17 / 7                |
| sqlite   | access_tokens | on                 | 22 / 2               | 22 / 2                |
| sqlite   | access_tokens | off                | 18 / 6               | 18 / 6                |
| pg       | session       | on                 | 21 / 3               | 21 / 3                |
| pg       | session       | off                | 16 / 8               | 16 / 8                |
| pg       | access_tokens | on                 | 21 / 3               | 21 / 3                |
| pg       | access_tokens | off                | 17 / 7               | 17 / 7                |

All eight cells passed at floor and latest: each profile selected 192 cases, with 154 passes and 38
expected configuration-specific skips. The floor harness records `codegen` as
unsupported by the Core `7.0.0` Ace kernel; configure, migration, typecheck, and all six integration
suites passed in each floor cell.

The SQLite concurrency case passed in all four configurations: eight idle and eight active
requests at concurrency four, zero failures in each state, and positive SQL observations.
Idle requests recorded 16 BEGIN/COMMIT pairs versus 32 while active; session writes were 24/40
and token writes 32/48 (idle/active). This includes the host admission gate and Kit work;
it is combined HTTP/transaction evidence, not isolated writer-lock timing or a capacity claim.
Latency and throughput samples are retained in the structured runner output.

Verified artifact SHA-256 values:

- Masquerade matrix artifact: `060dbe029e58dcf7126d92d55328ae46c8cf26c9d5ce017db7a717ab53d57d06`.
- Account Kit release artifact: `38fd950b08990a95b780d3077ad65f3a98bb898cb858b7b2f9eaabaae236a3d2`.

Reproduce with Node 24 and an accessible PostgreSQL 16 instance. The runner obtains the pinned
GitHub release artifact from the `adonisjs-account-kit` development dependency:

```sh
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=account_kit DB_DATABASE=package_test \
pnpm test:account-kit --profile=all --database=all --strategy=all --session-management=all
```

Runner JSON records all 16 cells, resolved dependencies, archive hashes, named timings and
per-command logs. It records the `codegen` capability as unsupported at Core `7.0.0`, then continues
with the commands and suites supported by that floor.

### Repository, mutation and guide evidence

All six required scripts passed under Node 24 in clean candidates: `pnpm lint`, `pnpm typecheck`,
`pnpm build`, `pnpm quick:test` (271 passed, 1 existing skip), `pnpm test:pg` (267 passed,
1 existing skip) and `pnpm test:built-exports` (8 passed), including the final guard regressions
at consumer commit `15f5dd0`. The documentation candidate `03b78ef`
also passed `pnpm docs:build`; its root suite includes four documentation-link cases.
Root dependencies use locked TypeScript 5.9.3; the packed latest host above separately verifies 6.0.3.

Fifteen temporary adapter mutations were caught by named authority/service tests. They cover
ability denial/capture, stamp reuse/encoding/access, denial-class matching, mandatory Kit current
validation, operational propagation, provider/snapshot/canonical identity, missing users, actor
owner consistency, driver strategy and runtime options. Twenty-four blocker/provider/accessor
mutations cover expiry, registered names/methods/paths, guard configuration, installed blocker,
router commitment, exemptions, raw authentication, active blocking, report labels, inline middleware
non-invocation, error mapping, native binding/managed HTTP availability, user/identifier validation
and owner namespace. All mutations were restored and focused suites passed. Some mutation results
were recorded from named failures without retained raw logs; setup-error attempts were excluded.
Independent review of the added guard regressions found no remaining issues.

For `0.1.1`, the guide session snippets were installed in a separate disposable host with Account
Kit `0.1.1` and Masquerade artifact SHA
`060dbe029e58dcf7126d92d55328ae46c8cf26c9d5ce017db7a717ab53d57d06`.
Its provider setup, route report and `pnpm typecheck` passed. A view-mode journey passed (1 case)
and admission passed (3 cases). The copied smoke requests selected view mode to match the guide's
policy, and the protected business route had a matching `business.*` name. This verifies the
documented session wiring and runtime path; it is not a usability study.
