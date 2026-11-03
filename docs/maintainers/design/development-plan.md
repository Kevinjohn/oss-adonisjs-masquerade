# Development plan: consensus from design review

**Date:** 19 October 2026
**Inputs:** [prd-masquerade.md](prd-masquerade.md), [spec-masquerade.md](spec-masquerade.md)
**Review:** Two rounds: independent review, then a 20-item vote.
**Status:** Accepted by the owner on 19 October 2026, including the four owner decisions at the end. This is the development contract for v1. The issue #86 D1–D10 access change was accepted by the owner on 22 October 2026 and is recorded in the PRD addendum and SPEC §14.

## Verdict

The review concluded that the design is buildable as a focused open-source package only after roughly half of the SPEC is cut or deferred. No settled PRD boundary changes. The single biggest risk, identified independently across the review, is the effective-guard seam: it rests on Auth 10 Authenticator "last attempted guard" behavior, which is an implementation detail, and a stock AdonisJS 7 starter kit runs `silent_auth` on every route. That seam is proven in a real app before any core code is written.

## Agreed v1 scope

Unanimous unless noted.

1. **Transport:** native session guard only. Opaque access-token adapter is v1.1. JWT is out. Token guards stay unwrapped (actor) in v1.
2. **Account Kit:** adapter, inspection API and managed-route blocking move to v1.2. The native authority contract (`securityStamp`, `inspectAccount` callbacks) is the only contract; Account Kit later implements it. The inspection read must return a coherent `{account, revision}` snapshot under Account Kit's account lock or an equivalent; the adapter does the comparison.
3. **Effective guard:** mode admission runs only on business routes. Control routes (start/stop/status), login, signup, logout and public routes use the raw actor guard and never read the mode store during authentication. Logout never needs the store. Stop and status return 503 when the store is unavailable. M0 must prove facade `auth.user` is the effective user; there is no fallback that leaves the actor as `auth.user` with a target Bouncer. If the seam cannot be made to hold, M1 does not start. **Superseded for Account Kit managed routes only by [Accepted v1.2 change](#accepted-v12-change).**
4. **Route coverage (issue #86 access decisions accepted 22 October 2026):** no boot-time registry. Routes under an effective guard are business routes; safe methods are read, unsafe methods are mutation and denied in view mode; edit mode plus `allowMutation()` may permit ordinary mutations after target authorization. `sensitive()` always denies. Markers are explicit route/group middleware markers. `node ace masquerade:routes` prints every route grouped by guard and flags raw-guard routes that are not control routes. The host reviews that report as a release gate; it is not a boot gate. **Superseded for Account Kit managed routes only by [Accepted v1.2 change](#accepted-v12-change).**
5. **Context token on unsafe requests (PRD FR-14 stands):** required on every covered unsafe request, idle or active, and owner-bound. Token is `<revision>.<nonce>`: the stored per-revision random nonce for a row, or a deterministic value derived from namespace, actor ID and incarnation for a no-row actor. No MAC, no key provider, no format versioning. Shield owns CSRF. To make adoption survivable the middleware ships `contextEnforcement: 'report' | 'enforce'`: report mode logs would-be 428/409 outcomes while the host migrates forms, then the host flips to enforce. One Edge share renders the hidden field; `X-Masquerade-Context` header for Inertia and API clients. Clients must not refresh the token before replaying an old intent.
   _Dissent recorded:_ Some reviewers argued row-gating (token required only once the actor has a mode row) loses nothing for mode-revision staleness. Others showed the cross-account case: form rendered as A, logout, login as B in the same browser, submit. Shield CSRF already rejects that on session transport, but owner-binding is cheap and the PRD decision stands, so the vote went to idle-everywhere plus report mode.
6. **Security stamps:** store `sha256` of the host-supplied stamp, bounded, equality-compared. No sealing, encryption, key rotation or decryption failure paths. Captured at start, rechecked for actor and target on every active admission. Stop and expiry never read the stamp.
7. **Incarnation:** required explicit config, either `incarnation: 'id'` (host declares IDs are never reused) or `incarnation: (user) => string`. No silent default. Columns and audit fields keep incarnation.
8. **Policy callbacks:** required `canMasquerade({actor, target, reason?, request?})`, evaluated at start with the request and on every active admission without it; `false` is global invalidation, a throw is 503 with mode unchanged. Optional `canUseRequest({actor, target, request})` for request-local tenant or route denial; `false` is 403 with mode unchanged. Issue #86 adds optional `canEdit` for explicit per-start edit access and active edit-mode admission, accepted by the owner on 22 October 2026. `classify` is replaced by the markers in item 4. Start stays deny-by-default.
9. **Audit:** committed transitions are written in the same transaction as the CAS. Admitted start/stop denials, context conflicts and idle-stop no-ops are recorded through `recordControlOutcome` as the PRD settled; write failure is 503. Rate limiting is the host's `@adonisjs/limiter` on the mounted routes, documented, not package code.
10. **Observers:** after commit, emit through the Adonis emitter and log through the logger without awaiting; rejections are caught and routed to the emitter error handler so they cannot crash the process. No deadline, AbortSignal, slot cap or `onEvent`/`reportFailure` config hooks. _Owner decision:_ PRD FR-30 wording ("bounded pending callbacks") is satisfied by never awaiting; one reviewer preferred keeping a small bounded dispatcher instead.
11. **Outcome unknown:** a lost commit ack maps to 503 `E_MASQUERADE_UNAVAILABLE` with the transition ID logged server-side; GET status is the recovery path. No `readTransition` port and no separate code in v1. The transition ID is still generated before the CAS.
12. **Revision:** validated integer `number`, fail closed at `Number.MAX_SAFE_INTEGER`, one boundary test. The Lucid pg driver returns BIGINT as string, so the store parses and validates on read.
13. **Store:** core `ControlStore` contract, memory store for tests, one Lucid subpath supporting SQLite and PostgreSQL from v1. Conformance suite exported under `./testing`. Release gates: PostgreSQL two-connection race, and SQLite independent-connection CAS/audit tests covering busy-timeout and rollback.
14. **Retention:** `retention: { days: n } | 'host-managed'`; `masquerade:prune --batch-size`. Owner erasure is a documented SQL recipe, not an API.
15. **Durations and reason:** default 900 s, hard max 3600 s, host may only narrow. Reason: trim, normalize `\r\n` to `\n`, reject C0/C1 controls except `\n` and `\t`, then 1–500 code points and 2,000 UTF-8 bytes.
16. **Cut from v1 text:** JSON:API negotiation, i18n lookup (stable codes with English messages; the host exception handler localises), the 4×2×2 consumer matrix (v1 is one native-session consumer on SQLite and PostgreSQL at floor and latest, plus store conformance on both).
17. **Documents first:** before M1 the SPEC is rewritten to this reduced contract (target under 350 lines) and the PRD gets a short "v1 scope" addendum listing deferrals. _Met:_ the rewrite in 7c53ef7 reduced the SPEC from 801 to 348 lines. The accepted v1.1, access and v1.2 addenda (SPEC sections 13–15) have grown it since; the target applied to the v1 rewrite only.

## Milestones

| #    | Ships                                                                                                                                                                                                                                                                | Gate                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| M0   | Throwaway AdonisJS 7 hypermedia starter-kit app with an effective guard wrapping the session guard. Proves facade `auth.user`, `authenticatedViaGuard`, lazy Bouncer, `silent_auth`, `driverName` passthrough for `E_UNAUTHORIZED_ACCESS` rendering, Japa `loginAs`. | T-IDENTITY passes in the real app. SPEC rewritten per item 17.                                   |
| M1   | Core: state machine, CAS semantics on the memory store, policy, fixed expiry with injectable clock, nonce token, hashed stamps, reason rule, emitter events.                                                                                                         | Every row of the SPEC 6.4 transition table has a mutation-checked test.                          |
| M2   | Lucid store: migration stub, CAS plus event in one transaction, conformance suite on SQLite and PostgreSQL, prune command.                                                                                                                                           | Two-connection PostgreSQL race yields one winner and one event; SQLite busy/rollback cases pass. |
| M3   | HTTP: start/stop/status controllers, effective session guard, markers, context middleware with report/enforce, Edge share, error codes, `no-store` headers, `masquerade:routes`.                                                                                     | T-CONTEXT and T-ACTIONS pass in the M0 app.                                                      |
| M4   | `configure` command, docs (account-global scope, one-device logout, cross-device behavior, Inertia/fetch header, jobs and side effects, report-to-enforce migration), packed native-session consumer at floor and latest. Publish 0.x.                               | Requirement-to-test ledger for retained FRs.                                                     |
| v1.1 | Opaque access-token transport with a per-token masquerade ability.                                                                                                                                                                                                   | T-TOKEN.                                                                                         |
| v1.2 | Account Kit inspection API (in its repository), adapter, managed-route blocking.                                                                                                                                                                                     | T-KIT, T-KIT-HTTP.                                                                               |

## Answers to the PRD review questions

1. 15 min default, 60 min hard max; hosts may only narrow.
2. Yes, once the reason normalization order is fixed as in item 15; add one acceptable and one unacceptable example.
3. Yes: a revoked credential is denied by its native validator; an account-epoch change clears mode.
4. One host `securityStamp(user)` callback per subject drawn from a column the app changes on password, suspension, privilege or logout-all; rechecked on every active admission.
5. Sessions only in v1; opaque bearer in v1.1; JWT out.
6. Yes with report mode for migration; 428 missing, 409 stale.
7. Confirmed: core contract plus optional Lucid subpath, one row per namespace/actor/incarnation.
8. Logout-all advances the stamp; a server-only `invalidate(actorId)` helper is optional, not a hook system. _Owner decision, 23 October 2026 (issue #135):_ v1 ships it as the `masquerade:status` and `masquerade:stop` Ace commands, with a bounded `ControlStore.activeBatch` read that custom stores must implement.
9. `pruneEvents(before, limit)` plus the prune command; retention policy and erasure stay with the host.

## Owner decisions (accepted 19 October 2026)

- Item 5: idle-everywhere context token with report mode, not row-gating.
- Item 10: emit-and-forget with caught rejections satisfies FR-30; no bounded dispatcher.
- Account Kit adapter moves to v1.2; opaque token transport to v1.1.
- The SPEC rewrite (item 17) happens before M1, not in parallel.

## Accepted access change

Issue #86 records the owner-accepted D1–D10 changes to active request policy, policy callbacks, persistence and audit projection. The decisions are part of the development contract as described in the PRD addendum. See [prd-masquerade.md](prd-masquerade.md#issue-86-access-decisions-accepted-22-october-2026) and [spec-masquerade.md](spec-masquerade.md#14-view-only-default-and-per-start-edit-access-accepted-22-october-2026).

## Accepted v1.2 change

The owner accepted decisions D1–D13 for the Account Kit adapter and managed-route blocker on 22
October 2026. They add the optional `@kevinjohn/adonisjs-masquerade/account-kit` adapter and its provider,
coherent Account Kit account/revision inspection, native actor revalidation, host-owned admission
gates, managed-route blocking, and verified route-report classification. Core remains independent
of Account Kit; v1.2 supports one matching transport and SQLite/PostgreSQL. The complete contract,
including the narrowly superseded rules in items 3 and 4, is [SPEC §15](spec-masquerade.md#15-v12-account-kit-integration),
with product boundaries in the [PRD v1.2 addendum](prd-masquerade.md#v12-account-kit-integration-accepted-22-october-2026).

Acceptance and release gates are T-KIT and T-KIT-HTTP on both strategies, SQLite/PostgreSQL, and
peer floor/latest. The contract is accepted; adapter implementation and these verification gates
remain pending.
