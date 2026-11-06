# Repository conventions

Masquerade follows open-source AdonisJS conventions. The host application owns language, UI,
roles, permissions, tenant rules, route sensitivity, limiter policy and audit retention. The accepted
[development plan](design/development-plan.md) controls v1 scope; this repository does not target
AdonisJS Plus compatibility.

## Distribution

Releases are distributed as GitHub prereleases with a packed tarball. The manually dispatched
`release` workflow calls the reusable `checks`, `compat`, and `examples` workflows, then rejects
any release target outside `main`. Its final gate checks the tag and dated changelog, builds and
packs the package, and creates release notes with an install command and SHA-256 digest.
See [releasing](releasing.md) for the release procedure and local dry-run command.

## Architecture and boundaries

- Core depends on explicit ports: `ControlStore`, `NativeAuthority` and `MasqueradePolicy`.
- Framework and database integrations use narrow subpaths. Root import does not resolve Lucid or
  Account Kit. Lucid supports SQLite and PostgreSQL. Account Kit support is a v1.2 prerelease
  preview pinned to GitHub release artifact `0.3.1`; public registry publication is separate. The
  upstream Core `7.0.0` startup compatibility and the Masquerade floor/latest database and strategy
  matrix are verified. See the [integration guide](../guide/account-kit.md),
  [acceptance evidence](requirement-ledger.md#v12-account-kit-acceptance-t-kit-and-t-kit-http), and
  [historical compatibility brief](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/0adbe49/docs/maintainers/account-kit-core-floor-feedback.md).
- The raw native session guard authenticates the actor. The effective guard is used on business
  routes. The package never issues target credentials or unions permissions.
- Routes stay host-mounted. The host wires `masqueradeContext` after auth initialization and before
  `silent_auth`, mounts controls behind Shield and separate start/stop limiter budgets, and reviews
  `masquerade:routes` as a release gate.
- Every mode starts view-only. A host `canEdit` callback must return exactly `true` for an edit
  start and active edit admission. `allowMutation()` opts an ordinary route into writes in edit
  mode; it grants neither edit access nor target authorization. Billing and other sensitive routes
  must use `sensitive()`, which overrides access and the mutation marker. URL or route-name
  heuristics are not allowed.
- Files have one responsibility and names describe it. Tests follow source modules; shared fixtures
  live in `tests/helpers/`.
- Use the [source map](source-map.md) to locate the owner and focused tests for a change. Separate
  independent reasons to change when that reduces unrelated reading context; file length and a
  second caller are not prerequisites. Preserve ordered orchestration and atomic transitions.

## Toolchain and checks

Use Node 24 and pnpm. Run repository scripts rather than bare tools. The standard checks are
`pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm quick:test`, `pnpm test:built-exports`, and
`pnpm test:pg`. `pnpm test` runs the c8-wrapped root suite after its `pretest` lint hook; the
`checks` workflow runs it in both SQLite and PostgreSQL matrix cells. The packed native-session
fixture has its own lint, typecheck, test and report-mode commands.
`pnpm test:consumer` rebuilds and repacks the package before installing it, records floor/latest
dependency versions from actual package resolution and exercises SQLite/PostgreSQL consumers;
`--package=<path>` skips the rebuild and installs that tarball as given.

The `c8` block in `package.json` sets `lines: 93` and `branches: 87`: the lower of the SQLite
(94.29 / 88.14) and PostgreSQL (93.93 / 87.71) `checks` cells at `1f686d5`, rounded down.
With `bin/**` excluded, SQLite measured 95.32% statements and 91.84% functions; PostgreSQL
measured 94.92% statements and 91.84% functions. The statements and functions floors are 94 and
91, respectively: each rounds down the lower result across the supported databases.
Lowering a floor is a reviewed change to the config and this paragraph together.

`pnpm test:recipe --database=sqlite|pg|all` starts with the unwired
`examples/recipe-host` template, installs the packed package in a disposable directory, runs
`configure`, applies the marked literal setup and usage guide fragments, typechecks the host,
and exercises native auth, Shield CSRF, status/start/effective read/allowed mutation/sensitive
denial/stop. It compiles and executes the documented form-input helper. It checks that changing
the documented control guard or middleware order breaks synchronization, then runs broken-host
form-token and missing-context-middleware journeys to prove those request boundaries fail. The
runner preserves the host's existing Session and
Shield stack while inserting the documented context line, and it checks that the separate guard
still works. It cleans the temporary host and its SQLite database, and drops its uniquely named
PostgreSQL schema. It starts/stops the managed PostgreSQL server only when it owns the start;
set `RECIPE_PG_EXTERNAL=1` and the standard `DB_*` connection variables for a disposable external
PostgreSQL 16 server.

This is executable integration evidence for the selected guide fragments and one API-client HTTP
journey. It does not establish that an independent developer can follow the entire guide without
assumptions, nor that the example's full HTML workflow works in this small host. Record a separate
clean-room walkthrough for usability acceptance. `tests/docs_links.spec.ts` remains link and
anchor evidence only.

Use the bundled scripts to preserve flags and runtime setup. Do not add Docker support or use npm,
npx, yarn, or yarn dlx. `better-sqlite3` requires the pinned Node 24 runtime.

## External PostgreSQL

Use Node 24 (`nvm use`) and a disposable PostgreSQL 16 database when the managed local
binaries are unavailable. Provide all connection settings explicitly; the tests create and
remove their own tables, so never point them at a production or shared application database.

```sh
DB_CLIENT=pg DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=postgres \
  DB_PASSWORD=local_test_password DB_DATABASE=package_test pnpm quick:test
```

Replace these local example credentials with those of your disposable test database. This runs
the same suite directly against your server; it does not start or stop that server.

## Verification and release evidence

- A test counts as evidence only when it names and asserts the required behavior. Cite the exact
  test file and case, not only a T-family label.
- `tests/docs_links.spec.ts` checks relative paths and anchors. It does not prove the user guide
  content is complete; the M4 ledger maps each docs obligation to a page section.
- Keep the [requirement ledger](requirement-ledger.md) current for every retained FR, NFR and AC.
  Separate implemented, verified and shipped status. A test name is not a pass result; record the
  command/matrix outcome separately.
- M4's packed consumer evidence includes native session at floor/latest on SQLite and PostgreSQL,
  root optional-import isolation, canonical numeric/string/UUID identifiers and an alternate users
  table.
- The `compat` workflow checks minimum and latest supported peers, packed native-session consumers
  at floor/latest on SQLite and PostgreSQL, and the Account Kit consumer matrix. It runs weekly,
  for selected compatibility changes, and before a release.
- The `checks` workflow runs the coverage suite on SQLite and PostgreSQL for every pull request.
  Its SQLite cell also runs formatting, lint, typechecking, build, and built-export tests.
  The `examples` workflow runs the recipe, launchers, and browser journeys weekly, for selected
  example changes, and before a release. The `docs` workflow builds the site and uploads an
  artifact on pull requests; main-branch pushes and manual dispatch can deploy Pages.
  Automatic checks remain gated for private repositories; manual dispatch runs them.
- Do not publish, tag, merge, or rename as part of a release-candidate implementation task unless
  separately authorized by the owner.

## Public contribution privacy

Use neutral task-focused public content. Do not include private planning metadata, assistant or
provider attribution, tool traces, credentials, or the forbidden standalone word in any GitHub-visible
text. Review complete outgoing content before publication. No publication is part of the current
release-candidate scope.
