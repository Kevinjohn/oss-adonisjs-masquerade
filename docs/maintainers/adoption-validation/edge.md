# Native-session demo and fresh Edge host

## Tested revision and environment

- Package source: `7117345a94d6679d046b060b659bdb8bad40679b` (`main` at the start of this run).
- Historical package artifact: `native-session-package.tgz`, version `0.0.0`, SHA-256 `d251eecf42ef41fcd0b1226fb61b07741757bc3ce0ac7e2a6c6e2320047e867b`. This hash belongs to source `7117345a94d6679d046b060b659bdb8bad40679b`; the original archive is no longer present locally. The ignored `tmp/alpha-baselines/alpha-1/native-session-package.tgz` path now holds the newer candidate documented in the [alpha baseline record](../alpha-baseline.md), with a different hash. The historical hash and browser evidence below remain recorded.
- Runtime: macOS, Node `v24.21.0`, pnpm `11.23.0`.
- A clean source archive had no `node_modules/`, example `.env`, or example database. The fresh host came from official [`adonisjs/starter-kits`](https://github.com/adonisjs/starter-kits), `hypermedia/`, commit `449d77cc25dd08e036f442d2d39b760d43ccfbd3`; it had no Masquerade files or dependency before setup. It was materialized from an empty parent directory with `git clone https://github.com/adonisjs/starter-kits.git starter-kits`, `git -C starter-kits checkout 449d77cc25dd08e036f442d2d39b760d43ccfbd3`, and `cp -R starter-kits/hypermedia fresh-edge-host`.
- Local runs used fictional `operator@fresh.test` and `customer@fresh.test` accounts and SQLite under each disposable example's `tmp/db.sqlite3`. Browser HTTP port was `3372`; no repository or customer data was used.

## Clean demo checkout

The source was materialized from the exact revision into an empty temporary directory. With Node 24 on `PATH`, these commands passed:

```sh
pnpm install
pnpm build
pnpm pack:fixture
```

The documented example steps also passed: copy `.env.example` to `.env`, install the local fixture with `pnpm install --no-frozen-lockfile`, run `node ace generate:key`, `node ace migration:run`, and `node ace demo:seed`. The seed command created the fictional operator and two customer accounts. The app started on `127.0.0.1:3372`; the browser showed the operator and effective customer separately, allowed reading customer data, changed email updates Off → On → Off, denied the sensitive route with `403 E_MASQUERADE_ACTION_BLOCKED`, rejected a previously rendered mutation after another tab changed context with `409 E_MASQUERADE_CONTEXT_CHANGED`, and stopped through the operator's raw session. Final status was idle.

Evidence: [active customer view](evidence/edge_customer_active.png) and [idle after stop](evidence/edge_idle_after_stop.png). The stale-form outcome is recorded from the browser run; the previous purported demo stale-form screenshot was an idle-state image and has been removed. The fresh-host stale-form failure and response are captured below. The demo's landing page also requested a missing `/favicon.ico` and received 404; it did not block the journey.

## Fresh Edge integration

The official starter was copied from the recorded upstream commit into an empty host directory. Before setup it had standard signup/login, session auth, Edge views, and Lucid SQLite only. The local artifact was copied in; no registry dependency was used.

Initial dependency install attempted `pnpm install --frozen-lockfile`. The sandboxed registry request failed with `ENOTFOUND`; retrying the same install through the authorized host route succeeded. A subsequent local-tarball add first failed because pnpm selected a different default store in the temporary directory (`ERR_PNPM_UNEXPECTED_STORE`), and an explicit store path was not readable from the sandbox (`ERR_SQLITE_ERROR`). Retrying on the host route with the same store used by install succeeded. This was an execution-environment workaround; the project's package-manager configuration and lockfile policy were unchanged.

The preserved artifact is local and ignored by Git. To reproduce it from a clean checkout, set
`PACKAGE_CHECKOUT` to an absolute path to this documentation branch and `FRESH_EDGE_HOST` to the
absolute path of the newly copied starter. Build the exact package revision in another clean
worktree; do not pack the documentation branch and expect the same hash:

```sh
PACKAGE_SOURCE="$(mktemp -d)/package"
git -C "$PACKAGE_CHECKOUT" worktree add --detach "$PACKAGE_SOURCE" 7117345a94d6679d046b060b659bdb8bad40679b
cd "$PACKAGE_SOURCE"
nvm use
pnpm install --frozen-lockfile
pnpm build
pnpm pack:fixture
shasum -a 256 tmp/native-session-package.tgz
cp tmp/native-session-package.tgz "$FRESH_EDGE_HOST/native-session-package.tgz"
cd "$FRESH_EDGE_HOST"
```

Confirm the displayed SHA-256 equals the recorded `d251eecf...e867b` hash above before continuing.
This regeneration was also verified in a clean exact-source worktree for the alpha record.
From the fresh host, run:

```sh
pnpm install --frozen-lockfile
pnpm add file:./native-session-package.tgz --store-dir "$(pnpm store path)"
node ace configure adonisjs-masquerade --namespace=fresh_edge --guard=web
cp .env.example .env
node ace generate:key
patch -p1 < "$PACKAGE_CHECKOUT/docs/maintainers/adoption-validation/fresh-edge-host.patch"
node ace migration:run
pnpm typecheck
```

For the original run, the fresh host received a copy of the exact-source archive identified by the historical SHA-256 above. The old archive bytes are no longer retained here; regenerate them from the recorded source commit and compare the hash before treating a new build as equivalent. `pnpm install --frozen-lockfile` and `pnpm add` used Node `v24.21.0` and pnpm `11.23.0`; `$(pnpm store path)` kept the local tarball add on the install's store. The exact host-specific additions from this run are in [fresh-edge-host.patch](fresh-edge-host.patch). The patch was validated against a second clean copy of the same official starter revision: after installing the preserved package artifact and running `node ace configure adonisjs-masquerade --namespace=fresh_edge --guard=web`, it applied without conflicts. The subsequent `.env` creation, key generation, migrations, and `pnpm typecheck` all passed. The patch contains only the host-owned model/auth/config, migration, middleware order, routes, controller, input helper, and two Edge views; it does not copy an already-configured package demo.

For the patch-driven browser rerun, signup created `operator@patch.test` and `customer@patch.test` through the starter UI. After signup, the host's disposable SQLite records were assigned explicit identity values and roles with Node 24:

```sh
node -e 'const Database = require("better-sqlite3"); const db = new Database("tmp/db.sqlite3"); const update = db.prepare("update users set account_incarnation=?, security_epoch=?, active=1, masquerade_operator=?, can_mutate=1 where email=?"); update.run("patch-operator-incarnation", "0", 1, "operator@patch.test"); update.run("patch-customer-incarnation", "0", 0, "customer@patch.test"); db.close()'
```

The second fresh host ran under Node `v24.21.0` and pnpm `11.23.0`, on port `3373` with a fresh local SQLite database. Its browser journey showed the raw operator and effective customer separately, read customer data, changed email updates Off → On → Off, denied the sensitive route with `403 E_MASQUERADE_ACTION_BLOCKED`, rejected the stale form after stop/start with `409`, and stopped to idle through the raw actor session. The [sensitive-action denial capture](evidence/fresh_edge_patch_sensitive_action_403.png) shows the actual response. A Node 24 query after both the `403` and `409` confirmed `email_updates` remained `0`.

`configure` generated the provider/configuration, middleware, and Lucid control migration. Host-owned wiring then reused the generated `userProvider` in both raw and effective guards, made `web_effective` the default, set immutable incarnation/security-epoch/active callbacks and a deny-by-default operator/target policy, added host-owned eligibility and reversible-preference fields, set `contextEnforcement: 'enforce'`, ordered context middleware after Auth and before `silent_auth`, and added a small Edge support page, controls, customer read, preference route, and sensitive route. The starter's signup flow created both fictional users; local SQLite updates assigned the operator role and explicit account incarnations. These were host integration steps, not package-provided UI or a preconfigured fixture.

The first browser attempt found two public setup-guide gaps on the packed baseline:

1. `isActive: (user) => user.active` returned SQLite's numeric `1`, while the package requires a literal boolean. Target inspection failed closed with `503 E_MASQUERADE_UNAVAILABLE`. The checked-in native example already normalizes this callback with `Boolean(user.active)`, but the guide did not.
2. The setup guide's generated-config paragraph said to retain `contextEnforcement`, whose generated value is `report`. In report mode a stale business form is logged but allowed through; the first stale-form submission returned `302` and changed the preference. The guide's later paragraph did say to begin in `report` during rollout and switch to `enforce` after client migration, but that staging instruction conflicted with the completed-journey requirements and was not prominent beside the generated configuration.

The setup guide now normalizes `isActive`, uses `contextEnforcement: 'enforce'` in the completed configuration, and explains that `report` is temporary migration mode. The captured failing response is [503 before boolean normalization](evidence/fresh_edge_boolean_unavailable_before_fix.png); the corrected journey is shown in the fresh-host screenshots below. Per the correction request, the package generator default remains `report` for staged rollouts.

After both guide corrections, setup was repeated from another fresh official Hypermedia starter copy and fresh SQLite database. The exact configure output was reviewed, the documented host wiring was added, and `pnpm typecheck` passed. The real browser journey then passed: operator/customer identity separation, customer read, preference Off → On → Off, sensitive-route denial (`403 E_MASQUERADE_ACTION_BLOCKED`), stale tab mutation rejected after stop/start (`409 E_MASQUERADE_CONTEXT_CHANGED`, preference unchanged), and raw-guard stop to idle (`302`).

Evidence: [fresh active customer view](evidence/fresh_edge_customer_active.png), [fresh stale-form rejection](evidence/fresh_edge_stale_form_409.png), and [fresh idle after stop](evidence/fresh_edge_idle_after_stop.png). The initial `fresh_edge_customer_active.png` capture shows email updates Off. The corrected patch-driven run also captured [preference On](evidence/fresh_edge_patch_preference_on.png) and [preference Off](evidence/fresh_edge_patch_preference_off.png), after a real Off → On → Off journey; its [active host view](evidence/fresh_edge_patch_customer_active.png), [sensitive-action 403](evidence/fresh_edge_patch_sensitive_action_403.png), [stale-form rejection](evidence/fresh_edge_patch_stale_form_409.png), and [idle state after raw-session stop](evidence/fresh_edge_patch_idle_after_stop.png) show the same journey from the applied patch. The `403` response was `E_MASQUERADE_ACTION_BLOCKED`; the stale response was `409 E_MASQUERADE_CONTEXT_CHANGED`. SQLite showed the preference remained Off after both denied actions. The browser emitted expected console error entries for the exercised 403/409 response pages; no JavaScript warning was observed in this journey.

## Other paths at the tested `main` revision

The root launcher, Vue integration, same-origin JSON client, Inertia React integration, and illustrated walkthrough were absent at the tested main revision. Their separate pull requests were open and were not part of the checked-out source. They are **not delivered on this baseline**. The [Vue candidate has separate fresh-host evidence](vue.md); the other absent paths have no self-setup result here. Do not infer main-branch behavior from those candidate branches.
