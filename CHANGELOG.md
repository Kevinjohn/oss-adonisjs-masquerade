# Changelog

## Unreleased

## 0.2.8 - 2026-11-09

### Changed

- Require Account Kit `0.3.4` exactly.
- Examples: the Account Kit API example uses integer user IDs and a `users` table, matching
  Account Kit's defaults-only example. Remove the table and ID type environment switches from
  its model, controllers, migrations and compatibility assertion.

## 0.2.7 - 2026-11-08

### Changed

- Require Account Kit `0.3.3` exactly. The Account Kit examples take its 0.3.3 example changes.
- Docs: refusing operator targets is a recommended default, not a requirement. The policy recipe
  (`docs/recipes/who-can-masquerade.md`) shows how to allow them for view access, and the tradeoff.
  The 0.2.0 upgrade note is a recommendation in the same way. The examples keep refusing operator
  targets. Closes #296.

## 0.2.6 - 2026-11-08

### Changed

- Examples: the API example's default operator is `operator@example.com`, as in the other
  examples built on Account Kit, so the starter examples sandbox shows one address in every app.

## 0.2.5 - 2026-11-08

### Added

- An Inertia Vue example built on Account Kit's Inertia Vue example, in
  `examples/with_account_kit/inertia_vue`, for the starter examples sandbox.

## 0.2.4 - 2026-11-08

### Added

- `AccountKitAccountBlocker` middleware for host-owned native account routes, using the same
  raw-actor active-mode check as the managed Account Kit blocker.

### Fixed

- Block native account operations while masquerading in the API, Hypermedia and Inertia React
  Account Kit examples, keeping logout and Masquerade controls available. Closes #311.

## 0.2.3 - 2026-11-08

### Changed

- Require Account Kit `0.3.2` exactly.

### Added

- Examples: an Account Kit API example with CI checks for packing, installation, migrations,
  formatting, linting, types, build and HTTP tests.

### Fixed

- Examples: the Inertia React `.gitignore` describes `vendor` as a packed package build, matching Account Kit, so the starter examples sandbox merges it without a conflict. Closes #308.

## 0.2.2 - 2026-11-07

### Added

- Examples: Account Kit's Hypermedia and Inertia React starter examples with Masquerade added, in
  `examples/with_account_kit/`. An operator listed in `MASQUERADE_OPERATOR_EMAILS` can act as
  another account through Account Kit's adapter. They feed the
  [starter examples sandbox](https://github.com/Kevinjohn/oss-adonisjs-starter-examples);
  `pnpm test:with-account-kit` checks them.

## 0.2.1 - 2026-11-07

### Changed

- Support Account Kit `0.3.1`. The optional `@kevinjohn/adonisjs-account-kit` peer now declares
  `0.3.1` in place of `0.3.0`. Account Kit hosts install the `0.3.1` release tarball. Account Kit
  `0.3.1` changes only its development dependencies.

## 0.2.0 - 2026-11-06

### Added

- Recipes: a step-by-step path from the AdonisJS 7 Hypermedia starter kit to a working support
  page, plus recipes for policies, route markers and context tokens, and ending modes when an
  account changes. A terms page explains the vocabulary, and each example README lists the files
  to copy.

### Changed

- Support Account Kit `0.3.0`. The optional `@kevinjohn/adonisjs-account-kit` peer now declares
  `0.3.0` in place of `0.2.0`. Account Kit hosts install the `0.3.0` release tarball. Account Kit
  `0.3.0` has its own breaking changes; see its release notes.
- The example apps and the Vue and Account Kit guide policies refuse a target that is itself an
  operator. Before, an operator could start a mode, including edit access, for another operator.
  If you copied an example policy, add `!target.user.masqueradeOperator` (or your equivalent) to
  `canMasquerade` and `canEdit`.
- The testing guide recommends `truncate()` over `withGlobalTransaction()`: on SQLite, requests
  that read the Masquerade tables hang inside a global transaction.
- `pnpm demo` requires Node 24, matching `.nvmrc`; it now refuses Node 25 and later.
- The effective guards refuse an active-mode identity with 503 unless `masqueradeContext` ran for
  the request, so view-only, `sensitive()` and context checks cannot be skipped by a missing or
  misplaced middleware.
- Boot fails when an effective guard wraps a different native driver from its raw guard, and the
  provider refuses at ready to start with `masqueradeRoutes` mounted on an effective guard.
- `retention.days` is capped at 36,500. Reasons also reject lone surrogates, bidirectional
  controls, invisible separators and line or paragraph separators.
- New installs create the mode tables with a primary key on the owner columns. Existing tables are
  unchanged.
- Configure lists `start/masquerade_routes.ts` and `start/masquerade_limiter.ts` as conflicts when
  wiring, refuses a host without `#models/user`, writes the migration to the default connection's
  migrations folder, wires the context middleware before auth, and fails when a wiring codemod
  fails. `@adonisjs/assembler` is an optional peer.
- `pnpm lint` fails on warnings, and test runs that execute no tests fail.
- The Inertia React example moves to `@adonisjs/inertia` 5 and `@inertiajs/react` 3, matching the
  Vue example and Account Kit. The package is unchanged. To upgrade an app built from the example:
  - Set `@adonisjs/inertia` to `^5.0.1` and `@inertiajs/react` to `^3.7.1`, and add
    `@inertiajs/core` `^3.7.1`.
  - Remove the `@adonisjs/inertia/vite` plugin from `vite.config.ts`; v5 no longer ships it.
  - In `inertia/app.tsx`, type the page glob as `{ default: ResolvedComponent }` and return
    `page.default` from `resolve`.
  - Mark the layout's `<title>` with `data-inertia`.
  - Return flash messages from the Inertia middleware's `flash()` method and read them from
    `usePage().flash`. As shared props they stay in history state, and Back shows them again.
  - Tests that parse page data read the `<script data-page="app" type="application/json">` tag
    instead of the `data-page` attribute.

### Fixed

- Account Kit answers a non-canonical target ID with the generic denial instead of 503, so the
  difference no longer reveals which accounts exist.
- `masqueradeAuditFields` and Edge status no longer run admission on raw or unclassified routes.
- A failed PostgreSQL rollback retires only the lost connection instead of the write pool.
- A PostgreSQL serialization failure or deadlock is a compare-and-swap conflict. The control store
  contract and conformance suite check revisions, event kinds and copies of committed rows, and the
  memory store validates rows like the Lucid store.
- A start denial records the requested target and access, and is recorded against the idle row
  when the start cleared a lapsed mode. Stopping a lapsed mode records expiry.
- `masquerade:stop` and prune refuse a clock past year 9999; prune runs event retention before
  expiry.
- Blank optional form fields take their defaults instead of failing validation. The generated form
  controller refuses to run on an effective guard.
- After a raw session logout in the same request, the effective guard no longer reports the
  admission memoized earlier.
- The API client plugin keeps a context token the test set, and its teardown tolerates a removed
  operator.
- Examples: the Account Kit fixture gates its `/support` routes, `.env.example` leaves `APP_KEY`
  empty, the Inertia apps register the Masquerade commands, Vue's dashboard uses the effective
  guard, and Edge component text props are escaped.
- Select the greatest compatible stable peer version independently of registry result ordering in both compatibility harnesses.
- Validate React example login fields before credential lookup.
- Hide stale Vue workspace customer identity during revalidation and preserve explicit safe recovery when validation fails or expires.
- Count expected-failure regression cases as executed tests in changed-file checks.
- Preserve demo, changed-check and consumer cleanup failures, bound owned process cleanup after interruption, and retain complete consumer output and command errors.
- Attempt PostgreSQL benchmark rollback, schema removal and client shutdown without hiding earlier failures.
- Report invalid service configuration as a configuration/unavailable diagnostic while preserving the setup exception and field.
- Preserve invalid-store setup errors from pruning instead of converting them to operational unavailability. Throwing store factories still report unavailability.

## 0.1.5 - 2026-11-03

### Changed

- Move the public provider import to `@kevinjohn/adonisjs-masquerade/masquerade_provider`. Update the
  provider entry in `adonisrc.ts` and any runtime type imports from
  `adonisjs-masquerade/providers/masquerade_provider`; the former subpath is no longer exported.

- Package renamed to `@kevinjohn/adonisjs-masquerade`. Migration: reinstall from the new
  tarball; replace `adonisjs-masquerade` with `@kevinjohn/adonisjs-masquerade` in imports; change the provider
  line in `adonisrc.ts` to `@kevinjohn/adonisjs-masquerade/masquerade_provider`.

- Support the scoped Account Kit `0.2.0`. The optional `@kevinjohn/adonisjs-account-kit` peer now
  declares `0.2.0` in place of the unscoped `adonisjs-account-kit` `0.1.4`. Account Kit hosts
  install the scoped `0.2.0` release tarball, replace `adonisjs-account-kit` with
  `@kevinjohn/adonisjs-account-kit` in imports and `adonisrc.ts` provider entries, and use the
  scoped name with `node ace configure`. Account Kit `0.2.0` has its own breaking changes; see its
  release notes.

- Breaking: `MasqueradeError` extends AdonisJS `Exception` and carries a stable `identifier`;
  `MasqueradeSetupError` extends `RuntimeException` instead of `TypeError`. The root export gains
  an `errors` namespace containing the two error classes.
- Breaking: invalid arguments at public entry points throw `InvalidArgumentsException` instead
  of `TypeError`, with the existing messages preserved.
- Breaking (types): observer and compare-and-set events accept transition kinds only;
  `recordControlOutcome` accepts `ControlOutcomeEvent`. Custom control stores may need narrower
  method signatures.
- Error JSON messages use the host request's `i18n` lookup at `errors.<code>` when present, with
  fixed English fallbacks. No translations, loader, or locale setting are shipped.
- The Account Kit demo's admission denial uses the `{ errors: [...] }` JSON envelope and keeps
  its existing HTML recovery pages.
- Runtime and command logger adapters add fixed English messages for transitions, diagnostics,
  and observer failures.
- Test fixtures reject unsupported `DB_CLIENT` values, and the test runner shares Account Kit's
  timeout for V8 coverage instrumentation.

## 0.1.4-alpha - 2026-11-03

- Support Account Kit `0.1.4`. The optional `adonisjs-account-kit` peer now declares `0.1.4` in
  place of `0.1.3`, and the Account Kit consumer matrix, demo and guide use the `0.1.4` GitHub
  release artifact. All 16 floor/latest SQLite/PostgreSQL cells pass for both strategies with
  session management on and off. No runtime code changed.

## 0.1.3-alpha - 2026-11-02

- Dependency update scans now fail on operational GitHub release lookup errors before creating
  or editing issues, and use pnpm for package repository metadata.
- `pnpm check` and the `checks` workflow now start with `pnpm format:check`, which runs
  `prettier --check` on the files git tracks, so formatting fails before lint and the tests run.
  Untracked local files are not checked. Edge templates and the Edge client guide are
  excluded because `prettier-edge` adds blank lines on every pass.
- The `dependency-issues` workflow now opens minor and major update issues monthly instead of
  weekly. Dependabot still opens patch pull requests weekly.
- Shorten the README to the pitch, install, a route example and links to the guides.

## 0.1.2-alpha - 2026-11-02

- Pin the repository and examples to TypeScript 5.9.3.

## 0.1.1-alpha - 2026-10-27

Alpha patch, distributed as a GitHub prerelease with the packed tarball attached. Not published to
a package registry. No runtime code changed from `0.1.0-alpha.1`.

- Support Account Kit `0.1.3`. The optional `adonisjs-account-kit` peer now declares `0.1.3` in
  place of `0.1.1`, and the Account Kit consumer matrix, demo and guide use the `0.1.3` GitHub
  release artifact. All 16 floor/latest SQLite/PostgreSQL cells pass for both strategies with
  session management on and off. No runtime code changed.

## 0.1.0-alpha.1 - 2026-10-27

First alpha, distributed as a GitHub prerelease with the packed tarball attached. Not published to
a package registry. Expect breaking changes before 1.0; no independent security review yet.

- Account-wide support mode for AdonisJS 7: an authorized actor uses the application as another
  user for a fixed time while staying authenticated as themselves.
- Native session and opaque access-token guards, with the actor on the raw guard and the effective
  user on business routes.
- View-only by default, per-start **Can edit** gated by `canEdit`, and `sensitive()` routes that
  stay blocked while a mode is active.
- `node ace configure adonisjs-masquerade` scaffolding, Lucid control store for SQLite and
  PostgreSQL, audit ledger, and the `masquerade:routes`, `masquerade:status`, `masquerade:stop`
  and `masquerade:prune` commands.
- Optional Edge banner and form-controller scaffolding, a Japa API client plugin, and an Account
  Kit integration preview.
- Runnable fictional demos: native session with Edge, Inertia React, Inertia Vue and Account Kit.

### Development history

- Add `pnpm check:changed [base]`, which runs only the checks that a branch's changed files need.
- Reject package control handlers whose selected guard is not raw, and flag effective-guard control routes in `masquerade:routes`.
- Export `stampFrom` to build deterministic security stamps from host-selected account fields.
- Pull request CI now runs only lint, typecheck, build, the built-export test and coverage. The demo
  launcher, recipe, Account Kit demo, browser suite and Inertia examples move to a new `e2e`
  workflow that runs on pull requests touching `examples/`, `http/`, `stubs/` or `docs/guide/`,
  nightly and before release, with Chromium cached. The Account Kit consumer matrix moves to a
  nightly and release-only `account-kit` workflow, and the docs build runs only when `docs/`
  changes. A new push cancels the stale pull request run.
- The package tarball now contains only the build output, README, licence, changelog and security
  policy. The guides are no longer packed; read them on the documentation site or GitHub.
- Make `pnpm test:consumer` rebuild and repack the package before installing it, and stop when
  the build or pack fails, so a failed build can no longer leave an older tarball to be tested.
  `--package=<path>` still installs the given tarball as is.
- Move the design documents to `docs/design/` and the integration notes for code agents to
  `docs/guide/agents.md`, which is now part of the documentation site.
- Rename the repository to `Kevinjohn/oss-adonisjs-masquerade` and move the documentation site to
  <https://kevinjohn.github.io/oss-adonisjs-masquerade/>. Old repository links redirect; the old
  documentation address does not. The design documents are now `PRD-masquerade.md` and
  `SPEC-masquerade.md`.
- Add `node ace masquerade:status` to list active modes and `node ace masquerade:stop --actor <id>`
  (or `--all`) to end them from the server, audited as `invalidated` with the `operator_stopped`
  outcome code. Adds `activeBatch({ limit })` to the `ControlStore` contract: custom stores must
  implement it to pass the updated conformance suite.
- `node ace configure adonisjs-masquerade` now wires starter-kit hosts: it rewrites a
  starter-shaped `config/auth.ts` to reuse the generated user provider and default to the effective
  guard, inserts the context middleware after `initialize_auth`, and, when `@adonisjs/limiter` is
  configured, generates and preloads the control routes and limiters. Other shapes are left
  unchanged with the manual step printed. `--no-wire` keeps the previous print-only behaviour.
- Add opt-in `configure --banner` scaffolding for editable host-owned Edge status UI and middleware
  that shares the safe mode projection with Edge and Inertia on authenticated effective routes.
  The package continues to ship no runtime UI; the host owns target labels, layout, and copy.
- Add opt-in `configure --form-controller` scaffolding for host-owned Edge form redirects and typed
  flash results while retaining JSON responses for API clients. Combined with `--banner`, the
  generated Stop form redirects through the host controller.
- Add `masqueradeRoutes(router, options)` to `adonisjs-masquerade/http`. It mounts status, start
  and stop on `MasqueradeController` behind the raw guard's named `auth` middleware, with separate
  start and stop limiters, and throws at registration when the guard, auth middleware or either
  limiter is missing. The native-session example, the usage and setup guides and the configure
  instructions use it.
- Document listener recipes for chat alerts and a dedicated log sink on masquerade transition
  events, checked against a listener module that the native-session example type-checks.
- Add `adonisjs-masquerade/plugins/api_client` with `masqueradeApiClient()`, a Japa API client
  plugin whose `request.loginAs(actor).masquerading(target, options)` starts a real mode through the
  host's control routes, sends the context token on unsafe requests and stops the mode afterwards.
  `@japa/api-client` is a new optional peer dependency.
- Split the usage guide into the support journey, Edge forms, error recovery, and audit and history
  pages.
- Add `masqueradeAuditFields(ctx)` to `adonisjs-masquerade/http`, returning the safe actor and
  effective identity fields to spread into a host business audit record, and document a host-owned
  page for reviewing the `masquerade_events` ledger.
- Make the start reason optional by default with a `reason: 'optional' | 'required'` config
  option. An optional start without a reason stores a null reason on the active row and omits it
  from the audit event; `'required'` keeps the previous behaviour. Custom stores must accept a
  null reason on active rows to pass the updated conformance suite.
- Document setup, support workflow, persistent local data, and reset for the Account Kit demo.
- Add a prerelease Account Kit integration preview pinned to GitHub release artifact `0.1.1`, with installation instructions, optional adapter, actor and target admission gates, managed-route blocker, route report, and floor/latest SQLite/PostgreSQL matrix evidence for both strategies. Public registry publication remains a separate release step.
- Add view-only-by-default starts with optional per-start edit access gated by `canEdit`, include
  `access` in active mode and audit projections, and return typed `blockedBy` details for blocked
  actions. Add nullable `access` columns to the mode and event tables by editing the unpublished
  create migration in place; recreate existing demo and example databases before running the
  updated package. Custom stores must persist access and reject event/row access mismatches to
  pass the updated conformance suite. Examples now offer View only and Can edit at start and
  explain blocked actions in host-owned pages.
- Add a runnable bearer API lifecycle to the native-session example, including token issuance,
  effective customer reads, shared browser mode, stop, and native revocation.
- Add v1.1 opaque access-token authentication that shares account mode with native sessions and
  requires an explicit per-token `masquerade` ability on integrated routes.
- Add a runnable Inertia Vue support workflow, integration guide and packed-example checks.
- Add a runnable Inertia React support-workflow example with context-bound forms and recovery.
- Add a same-origin session JSON client for the fictional support workflow and customer actions.
- Add a one-command launcher for the fictional native-session demo, preserving existing local configuration and data.
- Add an illustrated masquerade walkthrough captured from the fictional native-session demo.
- Organize adoption guidance by integration task and add safe troubleshooting paths.

Add documentation, native-session recipe, and browser checks to pull-request validation.

Organize the README and documentation landing page around the demo, integration guides, and
security and operations paths.

Map supported package imports to generated API symbols and remove edit links from generated pages.

Add a fresh native-session host recipe check for the documented wiring and SQLite/PostgreSQL HTTP journey.

Exercise the native-session support workspace in isolated browser journeys, including stale forms,
account-wide sessions, expiry and recovery.

Document the native-session support-mode journey with JSON controls, Edge adapters, business guards and recovery guidance.

Add a browser support workspace to the native-session example, with raw status and stop recovery,
customer-scoped read and reversible preference, and a sensitive-action denial.

Attach independent actor-keyed rate limits to native-session start and stop controls.

Expand native-session setup guidance for additive auth wiring, provider sharing, and policy callback lifecycle.

Distinguish name-inferred host controls from positively recognized package controls in the route
coverage report.

Add repeatable local demo setup with a fictional operator, two customers and a bounded reset
command.

Separate native-session application routes and configuration from explicitly enabled test probes.

Log bounded, privacy-safe diagnostics for core operational failures and control denials.

Add stable field-aware setup diagnostics for invalid configuration and store contracts.

Preserve the native session unauthorized error when `getUserOrFail()` follows an unsuccessful
effective guard authentication attempt.

Point the PostgreSQL helper diagnostic to the documented external-server test instructions.

Pass package errors to the host exception handler and retain generic JSON responses as the default.

Return unavailable without writing a contradictory denial when idle-stop audit acknowledgement fails.

Allow native-session flash alerts to opt out of the five-second auto-dismiss timeout while
preserving their delayed reveal and manual dismissal behavior.

Render native-session production error pages when unmatched requests have no initialized auth or
session context, preserving the original HTTP status.

Fix the native-session example dashboard's logout form so authenticated pages render successfully,
and render its production error pages through the registered marketing layout.

Add a fail-closed configure scaffold, setup and security guides, a complete requirement ledger,
and an isolated packed-consumer harness for the supported dependency floor and latest versions
on SQLite and PostgreSQL.

Add the native session authority and effective guard, HTTP controls, route markers, context
enforcement with a report mode, safe Edge helpers, and the `masquerade:routes` coverage report.

Add the Lucid control store for SQLite and PostgreSQL, a portable migration schema, and the
`masquerade:prune` command for bounded expiry and audit retention housekeeping.

Add the core state machine, revision-bound context tokens, hashed security stamps, fixed expiry,
policy checks, atomic memory store and control-store conformance helpers. Keep mode and audit
projections separate from user records and isolate observer failures from committed transitions.

Reject malformed UTF-16 in provider identifiers, account incarnations and security stamps, and
reject control-store transitions whose audit event does not match the committed owner and row.

Add a native-session starter fixture that proves the effective guard, raw actor identity,
lazy Bouncer resolution, silent authentication, native error rendering, Japa login and operator
isolation before package implementation.

Repository scaffold. No package behaviour yet; see [DEVELOPMENT-PLAN.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/maintainers/design/development-plan.md) for
the milestones.
