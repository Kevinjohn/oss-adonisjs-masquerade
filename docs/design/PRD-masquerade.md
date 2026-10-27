# Product requirements: AdonisJS account masquerade

**Status:** Revised review draft. Existing settled boundaries and the review decisions below constrain the companion technical design; the issue #86 D1–D10 addendum was accepted by the owner on 22 October 2026. This document does not authorize implementation.
**Date:** 19 October 2026
**Related technical design:** [SPEC-masquerade.md](SPEC-masquerade.md)

## Product outcome

Build an independent package that lets an authorized operator set their account to masquerade as a target account. The setting lives on the server and applies to the operator account across that account’s authenticated sessions and devices. The operator’s native authentication remains intact: requests authenticate as the operator, while the application’s effective principal for ordinary account behavior and Bouncer authorization is the target.

This is an account-level mode, not a replacement browser login or a newly issued target credential. Starting or stopping masquerade does not create target sessions or tokens, replace the actor’s credentials, or require credential restoration. The application must preserve the distinction between the authenticated actor and effective target. Ordinary native authentication may still restore an actor session through remember-me or update its cookies according to host policy; masquerade adds no credential issuance, rotation, renewal, or lifetime extension of its own.

The package targets AdonisJS 7, native Auth 10, and Session 8. It is an independent new package, not a fork, and must work without Account Kit. An optional Account Kit adapter may integrate account eligibility and current security state. The application owns its interface, authorization vocabulary, roles, permissions, tenancy, route policy, and language.

Success means an application can explicitly configure the package, deny masquerade unless its authorization callback allows it, apply one server-side actor-to-target mode consistently across the actor’s valid credentials, authorize ordinary requests as the target, and retain an auditable record of who enabled the mode and when it ended.

## Users and jobs

- **Support or operations operator:** needs to reproduce a target account’s application experience while remaining authenticated as themselves and without knowing or changing the target’s password.
- **Application maintainer:** needs a small package boundary, explicit policy hooks, and clear integration with existing Auth and Bouncer behavior.
- **Security or compliance reviewer:** needs to distinguish actor from target, know how account-level mode is enabled and ended, and understand credential revocation and audit behavior.
- **End user:** needs account security actions, credentials, and recovery paths protected while an operator is acting through their account context.

## Settled product boundaries

1. **Independent package:** Build a new package, not a fork. The package must remain usable without Account Kit. Account Kit stays lean; no credential issuance or session replacement extension is required for masquerade.
2. **Account-level server state:** Masquerade is a server-side setting keyed to the authenticated actor account and authority namespace. The proposed scope applies across that actor's sessions and devices through the integrated guards; exact transport coverage remains a review decision. A setting is not carried as client-controlled identity state.
3. **Actor remains authenticated:** The underlying native guard continues to authenticate the original actor on every request. A separate effective guard returns the target for ordinary business-route `auth.user` and Bouncer checks. Raw actor guards are reserved for authentication, control/security routes, and trusted audit context. Actor identity remains available separately; there must not be two conflicting meanings of `auth.user` in one route.
4. **No permission union:** Normal target-facing authorization is evaluated as the target. Actor permissions are not added to target permissions. The actor’s separate identity is available to the explicit masquerade policy and audit.
5. **Explicit application authorization:** Start is denied unless the application supplies a callback and it approves this actor-target pair. The application owns whether an actor can masquerade and access a target, including tenant constraints.
6. **No nesting:** A request already operating in masquerade mode cannot start another masquerade or overwrite the current target. The operator must stop the current mode first.
7. **No new target credential:** Masquerade does not create a target session, cookie, API token, or credential. It does not switch the authenticated actor credential or require actor credential restoration.
8. **Application-owned UX and policy:** The package ships no runtime admin UI, role/permission system, or translation catalog. On explicit `configure --banner`, it may generate an editable, host-owned starter view and middleware, and on explicit `configure --form-controller` an editable host-owned form controller; both flags are off by default and the generated files are ordinary application code. The starter displays only the safe mode projection and target ID. The host owns any display-name lookup, final markup, stop-response presentation, and localized copy. Documentation may show a status indicator and stop control. If the host uses `@adonisjs/i18n`, the host owns localized copy with English fallback. No locale detection or package language setting.
9. **Open-source AdonisJS fit:** Follow open-source AdonisJS conventions. AdonisJS Plus compatibility is not a product goal.
10. **Transport boundary:** The product is not categorically browser-only. It may apply to supported authenticated request transports. Which actor transports receive v1 adapters is an open review point; an optional JWT adapter is deferred for v1 unless review decides otherwise.

### Decisions from document review

- Preserve ordinary native authentication behavior; compare credential effects with an equivalent request without masquerade.
- Separate account-wide actor/target eligibility from request-local tenant access. Local denial rejects only that request and never clears a mode valid elsewhere.
- Accept an optional start reason by default; a host may require one. A supplied reason is trimmed before validation and contains 1–500 Unicode code points and at most 2,000 UTF-8 bytes.
- Durably audit committed transitions and admitted start/stop control outcomes. Native authentication failures, status/business denials and requests rejected before the control audit boundary use host diagnostics, not mandatory package audit writes.
- Bound post-commit observer/reporting work, include namespace and account incarnations in business audit context, and explicitly block billing mutations while active.
- **Issue #118 — opt-in generated status UI:** `configure --banner` is opt-in and generates editable host files for Edge status and safe Edge/Inertia status sharing. The package keeps no runtime UI component. Generated status data uses `ModeView`; the host may replace the target ID with its own display label without exposing application records to the package. Later generated host form adapters may add redirect behavior without changing this boundary.
- **Issue #127 — opt-in generated form controller:** HTML form posts are handled by a host-owned controller that `configure --form-controller` generates, not by the package controller. The host owns redirect targets, flash format, Inertia history clearing and error wording; the package controller stays JSON-only and gains no redirect or flash options.

## Scope

### Included in v1

- An account-level server-side mode mapping an authenticated actor account to a target account.
- Explicitly mountable `POST /masquerade/start`, `POST /masquerade/stop`, and `GET /masquerade` endpoints. These are proposed default paths; the final package/API names remain review decisions.
- Native authentication remains the actor. Application middleware/wrappers expose the target as the effective principal to ordinary target-facing Auth/Bouncer behavior.
- Explicit application callback for actor authorization and target eligibility. Missing, denying, or failing callback means deny.
- Fixed, non-sliding expiry and explicit stop.
- Unsafe request methods blocked by default while masquerade is active. The accepted issue #86 change adds view-only mode by default and per-start, host-policy-gated edit access; ordinary mutations additionally require route opt-in. Sensitive account and security actions remain denied.
- A non-secret context token or version on all covered authenticated unsafe business requests, including while no masquerade is active, so a stale rendered form cannot mutate under a newer server-side mode. Public login/proof endpoints and control/logout exemptions retain explicit separate contracts; they must not become business-route bypasses.
- Durable server-side coordination and audit records. SQL storage is an optional integration behind a core store contract; proposed first-party support is SQLite and PostgreSQL through a Lucid subpath.
- Native actor credential validation and an optional Account Kit adapter that relies on existing account/credential validation rather than issuing masquerade credentials.
- Documentation for application-owned status, target/actor visibility, stop action, route policy, and transport coverage.

### Out of scope

- A package-owned runtime operator dashboard, target search interface, user-management screen, or visual component. `configure --banner` may create editable app-owned starter files; the host decides whether to keep or replace them.
- New credentials, sessions, cookies, or tokens for the target.
- Password, MFA, recovery, email, credential, billing, or other sensitive security changes while masquerading.
- Automatic tenant switching or a package-owned tenant authorization system.
- Nested masquerade or union of actor and target privileges.
- Automatic read-only guarantees for GET handlers, already-admitted requests, background jobs, queues, external systems, or asynchronous work.
- Automatic global-revocation detection where the application has supplied no current security-epoch or account-access signal.
- A package-owned role model, language system, or localization catalog.
- JWT-specific support in v1 unless review selects it as a required adapter.

## Core concepts

- **Actor:** the human account authenticated by the application’s native credential on the current request.
- **Target:** the account selected by the actor as the effective application principal.
- **Masquerade mode:** account-level server state mapping one actor account to one target account within an authority namespace. Every integrated valid credential allowed to use the mode observes the same current setting; a restricted credential cannot bypass its own capabilities.
- **Effective principal:** the identity used by application behavior and ordinary target-facing authorization. It is the target while mode is active and the actor while idle.
- **Authority namespace:** the stable application identity domain that determines which actor ID and mode row are being addressed. Guards for the same users share a namespace; different identity domains must not collide. It is not a client-supplied tenant selector.
- **Revision:** a monotonically increasing server-side version changed atomically on mode transitions. It supports compare-and-swap and stale-request detection; it is not an authentication credential.
- **Context token/version:** a non-secret value rendered or returned by the server and submitted with unsafe requests to prove that the form/client observed the current mode revision. It does not authenticate an actor or identify a target.
- **Actor security epoch:** the current account-level security state captured when mode starts and rechecked according to application policy. A global account revocation or epoch change may invalidate account-wide mode.
- **Control record:** a durable audit record of committed mode transitions and admitted start/stop outcomes within FR-26’s audit boundary, distinct from host security diagnostics and observer notifications.

## Decisions and remaining review proposals

Durations, storage and credential policies below remain review proposals. The reason rule is a settled decision (made optional by default on 23 October 2026); other proposals must not be presented as approved requirements.

| Decision                  | Rule / proposal                                                                                                                                      | Review status                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial duration          | 15 minutes                                                                                                                                           | Confirm support workflow fit.                                                                                                                                        |
| Maximum duration          | 60 minutes                                                                                                                                           | Confirm whether per-app configuration may reduce, but never exceed, this maximum.                                                                                    |
| Duration behavior         | Fixed expiry; requests do not extend it                                                                                                              | Prevent activity from silently extending account-level mode.                                                                                                         |
| Start reason              | Optional by default, host may require; trim, then require 1–500 Unicode code points and at most 2,000 UTF-8 bytes                                    | Settled; made optional by default on 23 October 2026. Required mode rejects whitespace-only input. Instruct operators to redact sensitive details.                   |
| Mode storage              | One current row per authority namespace and actor account, with idle/active state and revision; SQL subpath proposed via Lucid for SQLite/PostgreSQL | Unlike the prior browser-session proposal, this is one row per actor account, not one per session/device. Confirm migration ownership, cleanup, and DB requirements. |
| Per-credential revocation | A revoked credential denies that credential; mode may remain for other valid actor credentials                                                       | Review whether only an account-wide epoch revocation ends the global mode.                                                                                           |
| Account-wide revocation   | A changed actor security epoch ends mode; invalid actor cannot continue                                                                              | Define the app callback/stamp used to recognize global revocation.                                                                                                   |
| Target validity           | Application validates account-wide target eligibility/current account state; global invalidity clears mode, while request-local denial does not      | Confirm whether target security stamp must be checked on every request for the desired guarantee.                                                                    |
| Actor transport adapters  | Native session and existing opaque native bearer credentials are proposed v1 coverage; no new masquerade token is minted                             | Confirm coverage. JWT-specific adapter is deferred for v1 unless required.                                                                                           |

The exact native access-validation contract, target security-stamp policy, and supported transport matrix belong in technical review. This PRD does not assume native Auth alone detects account-wide revocation.

## User journeys

### Start masquerade

1. An operator authenticates as themselves using an application-supported native credential.
2. From the host application’s own support workflow, they select a target, choose view (the default) or request edit, and supply a reason when the host requires one. A cookie-based endpoint uses application CSRF protection.
3. The package confirms the actor credential is valid, loads the actor’s current account-level mode and revision, and rejects a start if any target mode is already active.
4. `canMasquerade` decides whether this actor may masquerade as this target. For an edit start only, `canEdit({ actor, target, reason, request })` runs after `canMasquerade` and before request-local policy; absent or non-`true` denies without changing mode, while a throw fails closed. View starts do not call `canEdit`.
5. The package durably records the transition, atomically changes the actor’s mode to the target with the selected access, advances revision, and records the actor security epoch used by the selected policy.
6. Requests from all valid sessions/devices for the actor account resolve the target as effective principal on their next admission. Native Auth continues to identify each requester as the actor.

### Operate in mode

1. For every covered request, native Auth validates the current request’s actor credential.
2. The package reads current actor-account mode. If active, application code receives both actor and target identities; ordinary target-facing Auth/Bouncer behavior uses the target.
3. The application’s explicit policy and current account/credential checks determine whether mode may continue. Invalid actor or target state fails closed. Loss of account-wide eligibility clears mode; a tenant or route restriction local to this request rejects it without clearing mode for other devices.
4. Safe methods proceed through normal target authorization. In view mode, every unsafe request is denied. In edit mode, an unsafe request proceeds only if the route opts into ordinary mutation and target authorization passes. `sensitive()` always blocks first. If edit permission is revoked, admission invalidates the mode with `edit_denied`; it does not downgrade.
5. Blocked unsafe actions return `blockedBy` as `sensitive`, `view_only`, or `mutation_not_allowed`; the host owns diagnostics and response presentation. Every covered authenticated unsafe business request carries the current non-secret mode context token/version, even in idle mode. A form rendered before a mode change cannot mutate after that change. Explicit public/control exemptions follow the companion spec's separate contracts.
6. Other valid sessions/devices for the same actor see the same target mode on their next request. A request already admitted and executing cannot be recalled by a later mode change.

### Stop, expiry, revocation, or invalidation

- An authenticated actor request with the current credential's control capability may stop the actor account’s active mode from any of its valid sessions/devices. Stop is bound to the expected revision, uses CSRF protection for cookie transport, and does not require current permission to start a new mode. A narrowly scoped bearer credential must not acquire an account-control permission merely because it authenticates the actor.
- Stop clears the server-side mapping and advances revision. The actor was never replaced as the native authenticated identity; subsequent requests use the actor as effective principal.
- Expiry clears mode and advances revision. Any business request that discovers expiry returns a context-changed response and does not run that action as the actor, including a GET handler. A status/control request may return the resulting idle state. The client may refresh and submit a new actor-context action.
- A stale form or context version returns a context-changed response (proposed HTTP 409) and does not run the action under either a newer target or an unintended actor identity.
- If the target becomes globally invalid or the actor loses account-wide access to it, the mode is cleared and the triggering business request is rejected with context changed. It must not fall through and run as the actor.
- If the current actor credential is invalid, that request is denied by native authentication. Under the proposed policy, revoking only that credential does not necessarily clear account mode when another valid credential exists; an account-wide epoch revocation clears it.
- Logout of one session does not silently clear account-level mode for the actor’s other devices. Explicit stop, expiry, or account-wide revocation ends it. The host may explicitly define logout-all to advance the account epoch and invalidate mode.

## Authorization and request policy

| Situation                                                                       | Required behavior                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No explicit start authorization callback                                        | Deny start and leave mode unchanged.                                                                                                                   |
| Callback denies or errors                                                       | Deny start and leave mode unchanged.                                                                                                                   |
| Mode already active for actor                                                   | Deny nested start; do not replace target or extend expiry.                                                                                             |
| Native actor credential invalid                                                 | Deny through native authentication; do not treat target as the authenticated actor.                                                                    |
| Current actor credential revoked but another actor credential remains valid     | Proposed policy: valid credential may continue the same account-level mode; review whether the app must distinguish credential and account revocation. |
| Actor account security epoch revoked/changed                                    | Clear mode and deny target authority.                                                                                                                  |
| Target globally invalid or account-wide target eligibility lost                 | Clear mode, reject the triggering business request as context changed, and do not fall through to an actor action.                                     |
| Request-local tenant or route access denied                                     | Reject this request without clearing mode or falling through to actor behavior.                                                                        |
| Request is a safe method                                                        | Resolve target as effective principal if mode is valid; still apply ordinary target authorization. Safe method does not guarantee no side effects.     |
| Request is unsafe and mode access is not `edit`                                 | Deny with `view_only` while mode is active, even if route marker is absent.                                                                            |
| Request is unsafe, mode access is `edit`, and route opts into ordinary mutation | Permit only if target authorization and current mode context pass and the action is not sensitive.                                                     |
| Unsafe request has stale context token/version                                  | Reject with HTTP 409 context changed; do not run the business action.                                                                                  |
| Unsafe request has no context token/version                                     | Reject with HTTP 428 context required; do not run the business action.                                                                                 |
| Sensitive credential, identity, recovery, security, or billing mutation         | Deny as `sensitive` even if the mode is edit and the route otherwise allows mutation.                                                                  |
| Request reaches a route outside mode enforcement                                | This is a launch-blocking coverage defect.                                                                                                             |
| Mode changes after request admission                                            | The already-admitted request may finish; later requests use the new revision. Applications must handle downstream/asynchronous work.                   |

The default policy blocks unsafe methods but cannot prove a GET handler has no side effects. Applications own side-effecting GET routes, jobs, queue consumers, webhooks, and external systems. The package must not promise transaction rollback or cancellation of already-admitted work.

## Functional requirements

### Account-level mode and identity

- **FR-01 — Account-level server state:** The mode MUST be stored server-side and keyed by stable authority namespace plus actor account identity, not by browser session or client-supplied identity. Credentials allowed to use mode through an integrated guard MUST observe the same current setting. Immutable account incarnation prevents a deleted/reused numeric ID inheriting old state.
- **FR-02 — Actor authentication remains native:** Each request MUST authenticate the actor through the application’s existing native credential. Masquerade MUST NOT replace actor identity, create a target credential, or introduce actor credential issuance, rotation, renewal, or expiry extension beyond ordinary native authentication. Native remember-me recovery and session/cookie maintenance retain their normal host behavior.
- **FR-03 — Effective target principal:** When mode is active, covered application behavior and ordinary target-facing Bouncer authorization MUST use the target principal. Actor identity MUST remain separately available for explicit policy and audit.
- **FR-04 — No permission union:** The package MUST NOT combine actor and target permissions. Tenant and object access remain application-owned.
- **FR-05 — No nesting:** Start MUST fail while an actor mode is already active, without changing actor, target, expiry, or revision except for a separately recorded rejected attempt.
- **FR-06 — Compare-and-swap revision:** The server MUST keep a monotonically increasing revision for each actor mode row and atomically compare/update it for start, stop, expiry, and invalidation. Competing transitions MUST not overwrite each other or report duplicate success.
- **FR-07 — Fixed expiry:** Active mode MUST expire at its recorded deadline and MUST NOT slide on requests. Proposed defaults are 15 minutes initial and 60 minutes maximum.
- **FR-08 — Explicit endpoints:** The package MUST expose explicit mountable start, stop, and status routes. State-changing cookie routes MUST use application CSRF protection. Endpoints MUST derive actor identity from native authentication, never a request-body actor ID.
- **FR-09 — Complete coverage:** Safe use MUST require mode enforcement and effective-principal resolution on every application route that can act with the target. Incomplete coverage MUST be identified as a launch blocker.
- **FR-10 — Stop through an authorized actor credential:** A valid credential for the actor account with its configured stop capability may stop the account-level mode using the expected current revision. Stop MUST NOT require permission to start another mode or target authentication.
- **FR-11 — Expiry/clear transition:** Expiry, explicit stop, target invalidation, or a defined account-wide revocation MUST clear active mode and advance revision. A request discovering a change MUST not silently execute its business action under a different principal.
- **FR-12 — Account-level logout behavior:** Logging out one session MUST NOT silently clear account mode across other sessions. The host may explicitly define logout-all/security-epoch changes to invalidate the account mode.
- **FR-13 — Cross-device behavior:** Documentation MUST explain that all valid credentials for the actor account see the same mode on their next request, and that already-admitted in-flight requests cannot be undone.

### Context and request policy

- **FR-14 — Context token on unsafe requests:** Every covered authenticated unsafe business request MUST carry the current non-secret server-issued mode context token/version, including when mode is idle. The token/version MUST bind a rendered form/client action to the mode revision and MUST NOT authenticate the actor or select the target. Explicit public/authentication/proof/logout exemptions retain their separate authorization contracts.
- **FR-15 — Stale form rejection:** A stale context token/version MUST reject the unsafe request with HTTP 409 context changed, and a missing token with HTTP 428 context required, without running the requested business action.
- **FR-16 — View-only default and edit access (accepted 22 October 2026):** A mode MUST start with view access unless the actor explicitly selects edit. Edit MUST be available only when the host's optional `canEdit` policy returns exact `true`; an absent, non-`true`, or throwing policy MUST NOT grant edit. An unsafe request MUST be denied unless the mode has edit access and the route opts into ordinary mutation. Sensitive actions remain denied.
- **FR-17 — Sensitive action block:** Credential, authentication, identity, recovery, account-security actions, and billing mutations MUST remain blocked while mode is active, even on opted-in mutation routes.
- **FR-18 — Ordinary target authorization:** Covered requests MUST evaluate ordinary target authorization as the effective target. Safe HTTP methods may have side effects; jobs and external systems need app-owned safeguards.
- **FR-19 — Business request invalidation behavior:** When global target validity, actor account state, expiry, or context revision changes, the triggering business request MUST be rejected and MUST NOT fall through to run under a different principal.

### Authorization, validation, and integration

- **FR-20 — Explicit authorization callback:** The package MUST require an application callback that explicitly approves actor eligibility and target access. No callback, denial, or callback error means deny. Continuation MUST distinguish account-wide eligibility from request-local tenant/route access: global eligibility loss clears mode; a local denial rejects only that request. Neither permits fallback to actor behavior.
- **FR-21 — Actor credential and epoch validation:** Every request MUST pass the application’s ordinary native credential validation. A proposed account-level security epoch is captured at start and rechecked to detect global revocation; the package MUST NOT claim automatic global revocation detection without such an application signal.
- **FR-22 — Target current-access validation:** The application MUST provide a way to check account-wide target eligibility/current access. Request-local tenant/route access is checked separately under FR-20 and does not invalidate global mode. The technical proposal requires a target security stamp captured at start and rechecked on every active admission; reviewers must confirm that requirement and its native integration cost.
- **FR-23 — Credential scope policy:** A single revoked actor credential MUST be denied by its native validator. Whether this alone clears account-global mode or only an account-wide epoch change clears it is a review decision; proposed default is mode may continue for another still-valid actor credential.
- **FR-24 — Account Kit integration:** The optional Account Kit adapter MUST reuse existing actor credential validation. A small proposed Account Kit public account-access inspection operation supplies target eligibility/current revision without claiming target authentication. This is a new API requiring review, not an existing method. Integration MUST NOT add target credential/session issuance or require core-package dependency on Account Kit.
- **FR-25 — Transport adapters:** The package MUST keep the actor/effective-target contract independent of browser cookie assumptions. V1 session and existing opaque native bearer adapters are proposed; JWT-specific integration is deferred pending review. No adapter may mint a masquerade credential.

### Audit and persistence

- **FR-26 — Durable audit record:** Every committed start, stop, expiry, and invalidation MUST atomically create a durable control record. After native actor authentication/ordinary access, CSRF and the applicable control limiter succeed, start/stop denials, validation failures, revision conflicts, and idle-stop no-ops MUST also be recorded when the store is available. Native authentication failures, pre-boundary rejections, status/business denials, and local credential/tenant denials on business requests use host diagnostics; they do not require package audit writes. Required record failure returns an operational error without permitting an action; uncertain commits retain their outcome-unknown contract.
- **FR-27 — Record contents:** Each control record MUST identify actor account and incarnation, target account and incarnation when applicable, authority namespace, time, event, outcome, and reason where required. It MUST distinguish requested and completed transitions.
- **FR-28 — Data minimization:** Audit data and logs MUST NOT contain credentials, bearer tokens, raw user objects, request bodies, or personal data beyond the IDs and bounded reason needed for accountability.
- **FR-29 — Reason policy:** The host configures `reason: 'optional' | 'required'`, defaulting to `'optional'`. In optional mode an absent, empty or whitespace-only reason starts the mode and the audit records no reason. In required mode empty and whitespace-only input MUST be rejected. A supplied reason is trimmed before validation and MUST have 1–500 Unicode code points and at most 2,000 UTF-8 bytes after trimming. Operator guidance MUST require redaction of secrets and unnecessary personal data.
- **FR-30 — Observer errors:** Failure or timeout of a non-authoritative observer/listener MUST be operationally visible but MUST NOT turn a completed mode transition into a reported failed transition or trigger a duplicate switch. Observer and diagnostic reporter waits MUST share a finite post-commit budget; pending callbacks and late rejections MUST be bounded/handled.
- **FR-31 — Optional store integration:** Core MUST define a persistence contract. Proposed SQL support is an optional Lucid subpath for SQLite and PostgreSQL. Importing the core package MUST NOT automatically import Lucid. Memory storage is for tests only.

## Non-functional requirements

- **NFR-01 — Fail closed:** Unavailable/malformed authoritative state, authorization errors, credential validation failures, target access failures, expiry, or ambiguous transitions MUST never grant target authority or run a target action. An authoritative absence of a row is the valid initial idle state; it differs from a failed store read.
- **NFR-02 — Cross-device consistency:** All requests for the same actor authority namespace MUST resolve one server-side mode row. Concurrent start/stop requests MUST use atomic revision checks and cannot lose a valid transition.
- **NFR-03 — Stale client safety:** A stale form/client context MUST fail on the next unsafe request after any mode revision change. This does not revoke work already admitted or handed off to asynchronous/external systems.
- **NFR-04 — Crash recovery:** After process restart or partial failure, the next request MUST determine mode from server-side state. Ambiguous state MUST be denied or cleared safely, never inferred from client values.
- **NFR-05 — Native security:** Actor authentication, CSRF, and transport validation remain the host framework’s responsibility. Context tokens are replay/version guards, not credentials.
- **NFR-06 — AdonisJS fit:** Public interfaces and behavior MUST follow open-source AdonisJS 7, Auth 10, and Session 8 conventions. Runtime target is Node 24; package management uses pnpm.
- **NFR-07 — Optional boundaries:** Core MUST remain usable without Account Kit and without the optional Lucid SQL subpath.
- **NFR-08 — Operational clarity:** Documentation MUST describe account-wide scope, one-session logout behavior, global revocation policy, supported transport coverage, context-token use, route coverage, and side-effect limitations.

## Acceptance criteria

- **AC-01:** Starting mode creates one durable server-side actor-to-target setting. No client marker or request-body ID can establish the mode.
- **AC-02:** Every valid integrated session/device for the same actor account observes the same active target on its next request; its underlying native guard still authenticates the actor. The effective business guard reports the target.
- **AC-03:** The target is the effective principal for ordinary target-facing Auth/Bouncer checks, while actor identity remains available separately and its permissions are not unioned.
- **AC-04:** Missing authorization callback, denied callback, or callback error leaves mode unchanged.
- **AC-05:** Nested start is denied without changing target or expiry. Concurrent commands using the same expected revision permit at most one successful state transition; later correctly sequenced commands may proceed normally.
- **AC-06:** Stop from any valid actor credential with control capability clears mode and advances revision without needing permission to start a new mode or authenticate the target.
- **AC-07:** Logging out one actor session does not silently clear mode for the actor’s other devices. Expiry and explicit stop clear the account-level setting.
- **AC-08:** A revoked actor credential is rejected by native auth; an account-wide security-epoch revocation ends mode according to the selected policy.
- **AC-09:** Globally invalid target/access state clears mode and rejects the triggering business request as context changed; it does not run as the actor. A tenant-local denial on another device rejects only that request and leaves the shared mode/revision unchanged; a local policy exception fails closed without clearing mode.
- **AC-10:** Expiry and stale context reject the triggering unsafe request without executing it under target or actor identity. The next fresh request sees the current effective principal.
- **AC-11:** Covered authenticated unsafe business requests require the current context token/version even while idle; old forms fail after mode starts, stops, expires, or clears. Exempt public/control routes cannot execute target business handlers.
- **AC-12:** View mode denies every unsafe request. Edit mode permits an ordinary unsafe request only when `canEdit` admitted the mode, the route opts in, and target authorization passes; sensitive actions, including billing mutations, remain denied. Blocked-action responses identify `sensitive`, `view_only`, or `mutation_not_allowed` for host handling.
- **AC-13:** Start/stop/expiry/invalidation audit records include actor, target when applicable, namespace, time, event, outcome, and reason as applicable, without secrets or raw user objects. Admitted control denials/no-ops follow FR-26; business/status denials do not require package audit writes.
- **AC-14:** Required store failure prevents a successful mode transition; non-authoritative observer failure, timeout, or reporter failure does not falsely report a completed transition as failed or indefinitely delay its response.
- **AC-15:** The package can operate without Account Kit or Lucid core imports; the Account Kit adapter does not mint target credentials.
- **AC-16:** Documentation explains supported transports, CSRF for cookie endpoints, context-token handling, full route enforcement, account-wide logout semantics, and side-effect limits.

## Operational and privacy requirements

- The host application should show an obvious indication that effective target behavior is active and offer a stop action. This remains application-owned UI.
- Every start is attributable to the authenticated actor account, and to a bounded reason when one is given or the host requires it. The reason is not a case-notes field; operators must redact secrets and unnecessary personal details.
- Durable audit records follow the host application’s access and retention policy. The design must define the minimum fields and a deletion/retention integration point without selecting a legal retention period for the host.
- Operational logs should diagnose authorization denial, stale context, expiry, invalidation, and persistence failure without recording credentials, tokens, request bodies, or raw account objects.
- The safe business audit projection MUST include authority namespace, actor/effective IDs and their immutable incarnations, including idle requests. Applications must decide how jobs and downstream systems capture actor and effective target. The package cannot guarantee queued work later executes with the correct context unless the application propagates and validates that context.
- A mode change applies to newly admitted requests. It cannot undo an admitted in-flight action or a side effect already handed to another system.

## Launch gates

1. Native authentication always identifies the actor, and target effective-principal behavior is explicit on every covered route.
2. Authorization is deny-by-default; target access and current account state come from explicit host callbacks.
3. Account-level mode is durable, namespaced, revisioned, and atomically transitioned.
4. Every covered authenticated unsafe business request validates current context token/version, including idle mode; public/control exemptions are explicit and state-changing cookie endpoints are CSRF-protected.
5. Unsafe route policy defaults to deny in active mode; sensitive security actions remain blocked.
6. Credential-level versus account-wide revocation semantics are documented and tested for the selected adapter.
7. Durable audit/store failure, concurrency, expiry, stale form, and cross-device behavior are verified.
8. Documentation explains route coverage, transport adapters, single-session logout behavior, and asynchronous/side-effect limits.

## Risks and mitigations

| Risk                                            | Product consequence                                                                                          | Required mitigation                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Account-global scope surprises an operator      | Other signed-in devices begin acting through the target too.                                                 | Make cross-device scope obvious in host UI/docs; allow an authorized valid actor credential on any device to stop the mode. |
| Actor and target identities become confused     | Authorization, logs, or actions may be attributed to the wrong account.                                      | Preserve native actor identity; pass effective target separately; test Bouncer behavior and audit attribution.              |
| Credential and account revocation are conflated | Revoking one device may unintentionally end every device’s mode, or global revocation may leave mode active. | Define credential-level and account-epoch checks explicitly in the adapter contract.                                        |
| Stale rendered forms mutate in a newer mode     | A form created as actor may submit after the actor starts masquerade, or vice versa.                         | Require current context token/version on all covered authenticated unsafe business requests, including idle mode.           |
| In-flight or asynchronous work outlives mode    | Already admitted requests or queued actions may continue after stop/expiry.                                  | State the limit and require applications to propagate/recheck context for background work.                                  |
| Route coverage is incomplete                    | Some handlers act under effective target without policy or context validation.                               | Treat complete enforcement as launch gate; document framework integration and coverage checks.                              |
| Durable state races or store outage             | Concurrent transitions may overwrite one another or falsely report success.                                  | Use atomic compare-and-swap revision updates and fail closed on required persistence failure.                               |
| Optional target checks are too weak             | A disabled/revoked target may remain effective.                                                              | Require explicit app target-access validation and review per-request security-stamp needs.                                  |
| SQL integration adds cost                       | Applications may inherit ORM/database assumptions.                                                           | Keep SQL as an optional subpath behind a store contract; keep core independent.                                             |

## Alternatives considered

- **Switch the browser’s native login to the target:** rejected by the updated product direction. Masquerade is an account-level server setting; the native actor credential remains authenticated.
- **Mint a target session or access token:** rejected because that would create a second target credential and complicate revocation and actor attribution.
- **Store mode per browser session:** rejected because the selected behavior applies to the actor account across valid sessions and devices.
- **Union actor and target permissions:** rejected because it can elevate the target and obscures which identity authorized a request.
- **Attach core behavior directly to Account Kit:** rejected because the feature must serve applications that do not use Account Kit.
- **Ship an operator interface or role system:** rejected because applications own their support workflow, authorization model, and language.
- **Assume browser-only forever:** rejected as a product boundary. Transport-specific adapters must be reviewed, and JWT-specific work is deferred for v1.

## Review questions

1. Are 15-minute initial and 60-minute maximum durations appropriate, and may applications only reduce those limits?
2. Does operator guidance adequately explain the settled reason rule (optional by default, host may require; trimmed) and the prohibition on secrets or unnecessary personal data?
3. Confirm the account-level revocation rule: should revoking one actor credential reject only that credential while mode persists for another valid credential, with account-epoch revocation clearing mode?
4. What explicit native callback/stamp should establish current actor account security epoch and account-wide target eligibility? Request-local access remains a separate check under FR-20. Must target security stamp be checked on every request?
5. Should v1 support native session and opaque native bearer credentials, or sessions only? Is a JWT adapter explicitly deferred?
6. Is the non-secret context token/version practical on every covered authenticated unsafe business request, including idle mode? Are the explicit public/control exemptions narrow enough? Review the proposed HTTP 428 for a missing token and HTTP 409 for stale context.
7. Confirm the SQL integration boundary: core store contract plus optional Lucid SQLite/PostgreSQL subpath, one row per actor authority namespace rather than per device/session.
8. How should logout-all map to account security epoch changes, and should applications provide a dedicated invalidation hook?
9. What is the smallest useful control-record retention/deletion interface while keeping retention policy with the host application?

## v1 scope addendum (19 October 2026)

[DEVELOPMENT-PLAN.md](DEVELOPMENT-PLAN.md) is the accepted v1 development contract and answers the nine review questions above. The settled boundaries and document-review decisions are unchanged. The following items from the scope and requirements sections are deferred or cut for v1:

- **v1.1:** opaque access-token transport (FR-25 adapter clause, PRD boundary 10 coverage question). v1 covers the native session guard only; token guards stay raw actor guards.
- **v1.2 (accepted 22 October 2026):** the optional Account Kit adapter, existing account-access inspection operation and managed-route blocking (FR-24, AC-15 adapter clause), as recorded in the [v1.2 addendum](#v12-account-kit-integration-accepted-22-october-2026). Implementation and acceptance evidence remain pending.
- **Out:** JWT adapter; JSON:API error negotiation; package `@adonisjs/i18n` lookup (stable codes with English messages, host localises); the 4x2x2 consumer matrix (v1 is one native-session consumer on SQLite and PostgreSQL at floor and latest).
- **Simplified in the SPEC, requirement unchanged:** FR-09 coverage is a `masquerade:routes` release-gate report with `sensitive()`/`allowMutation()` markers, not a boot-time registry; FR-14 context token is an owner-bound `revision.nonce` value with `report`/`enforce` modes, not a MAC; FR-21/FR-22 stamps are stored as sha256 hashes, not sealed; FR-30 is satisfied by emit-and-forget observers with caught rejections; the outcome-unknown case maps to 503 `E_MASQUERADE_UNAVAILABLE` with GET status as recovery.
- **Resolved proposals:** 15-minute default and 60-minute maximum, host may only narrow; reason normalisation order fixed in the SPEC; credential revocation denies that credential while an advanced security stamp clears mode; one row per namespace, actor and incarnation; retention is `{ days }` or host-managed with a prune command and a documented erasure recipe.

## Dependencies and handoff

The technical design in [SPEC-masquerade.md](SPEC-masquerade.md) should map these requirements to package boundaries, identity resolution, actor/effective-principal contracts, transport adapters, revisioned mode storage, endpoints, context-token handling, and verification scenarios. Any proposal that changes a settled boundary should be called out for product review. Proposed defaults and review-sensitive transport/revocation choices should be resolved before implementation. This PRD and the companion design are review artifacts, not implementation authorization.

## Issue #86 access decisions (accepted 22 October 2026)

The owner accepted all D1–D10 decisions from issue #85 on 22 October 2026. This addendum records that acceptance; implementation may proceed within the stated scope.

| Decision | Accepted rule                                                                                                                              | Owner status        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| D1       | No `defaultAccess` configuration. Every mode starts in view; edit is selected per start.                                                   | Accepted 2026-10-22 |
| D2       | Add optional `canEdit`; absent, non-`true`, or throwing never grants edit. Keep `canMasquerade` unchanged.                                 | Accepted 2026-10-22 |
| D3       | If `canEdit` no longer returns exact `true` during active edit-mode admission, invalidate with `edit_denied`; do not downgrade.            | Accepted 2026-10-22 |
| D4       | Blocked business requests produce no package event or diagnostic; hosts use `blockedBy` for diagnostics.                                   | Accepted 2026-10-22 |
| D5       | `blockedBy` is a flat error-item field, present exactly for `E_MASQUERADE_ACTION_BLOCKED`.                                                 | Accepted 2026-10-22 |
| D6       | Access values are exactly `'view' \| 'edit'`.                                                                                              | Accepted 2026-10-22 |
| D7       | Add SPEC §14 with explicit supersession pointers at the old D09, I12, route rule, admission step, and start body.                          | Accepted 2026-10-22 |
| D8       | Edit the create migration in place; add no upgrade migration because there are no external deployments.                                    | Accepted 2026-10-22 |
| D9       | Use nullable `string(8)` access columns in both mode and event tables.                                                                     | Accepted 2026-10-22 |
| D10      | Project active-row access onto all corresponding audit events from both event producers; validate event access against the projected mode. | Accepted 2026-10-22 |

## v1.2 Account Kit integration (accepted 22 October 2026)

The owner accepted decisions D1–D13 for the Account Kit integration in issue #94 on 22 October 2026. This addendum changes the
v1.2 status from deferred proposal to accepted product scope; implementation and verification are
not yet claimed. The complete technical contract is [SPEC §15](SPEC-masquerade.md#15-v12-account-kit-integration),
and delivery sequencing is in the [development plan](DEVELOPMENT-PLAN.md#accepted-v12-change).

- Ship the optional adapter as `adonisjs-masquerade/account-kit`, with its provider at
  `adonisjs-masquerade/account-kit/provider` and an optional peer dependency pinned to the
  released Account Kit alpha. Core remains usable without resolving Account Kit, and there is no
  separate adapter package.
- Use Account Kit's coherent `inspectAccountAccess` snapshot for actor and target eligibility and
  revision stamps. Denied or missing accounts are ineligible; operational failures fail closed.
  Masquerade issues no target credential and adds no Account Kit storage.
- Revalidate the actor through both the native raw guard and Account Kit's configured managed
  guard. Account Kit credential rejection remains unauthenticated behavior. Admission is a
  separate `AccountAdmission` service exported from `adonisjs-account-kit/admission`, with DI
  binding from `adonisjs-account-kit/admission/provider`. Hosts import `admissionMiddleware` from
  the admission entry and apply
  `admissionMiddleware({ admission: async () => app.container.make(AccountAdmission), guard: managedGuard })`
  to selected Masquerade control/business routes before `masqueradeContext`, which otherwise may
  read mode and admit the request. In the host's `canMasquerade` policy, resolve the service with
  `const admission = await app.container.make(AccountAdmission)` and check
  `await admission.isAdmitted(target.id)`.
- While a mode is active, block all `accountKit.*` routes except the operator's logout and the
  session CSRF endpoint. The blocker reads the existing mode row only for authenticated managed
  requests; logout, CSRF and unauthenticated public proof flows remain store-free. A blocked
  action reports `E_MASQUERADE_ACTION_BLOCKED` with `blockedBy: 'sensitive'`.
- The provider verifies the configured guard and mounted managed-route registration. The route
  report marks Account Kit routes as protected only when blocker installation is recorded;
  otherwise they remain unclassified with a missing or unverified note.
- Support one Masquerade transport matching the Account Kit strategy (`session` or
  `access_tokens`) and SQLite/PostgreSQL. A second composed transport and MySQL are outside this
  scope. Account Kit admission revocation leaves the actor mode row intact; hosts that require
  mode invalidation use `changeRestriction`.

T-KIT and T-KIT-HTTP are the release acceptance families. Both must pass for session and
access-token strategies, SQLite and PostgreSQL, and peer floor/latest. Their cases are enumerated
in SPEC §15 and [the requirement ledger](../maintainers/requirement-ledger.md#v12-account-kit-acceptance-t-kit-and-t-kit-http).
