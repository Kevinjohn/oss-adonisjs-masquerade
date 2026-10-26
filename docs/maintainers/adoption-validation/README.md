# Clean self-setup validation

This record verifies setup from a clean package checkout and from a fresh, unconfigured AdonisJS host. It uses fictional accounts and disposable local SQLite data. It does not claim external usability testing, production readiness, or success for unmerged branches.

## Procedure

For each delivered path, record its exact source revision, clean starting state, Node/pnpm versions, operating system, package artifact SHA-256, commands, database and ports, browser outcomes, corrections, and privacy-safe evidence. Do not overwrite a tarball after recording its hash. Use a separate host directory and database for each path. Do not use `examples/native-session` as the fresh host: it is already configured.

### Native-session demo

1. Create a clean checkout at the candidate package commit. Confirm the example has no `node_modules/`, `.env`, or generated database.
2. Follow every command in `examples/native-session/README.md`. At the package root, build and pack the local artifact before installing the example.
3. In a real browser, sign in with the fictional operator, start a support mode, confirm the actor and effective customer are shown separately, read customer data, change and restore the reversible preference, verify the sensitive action is denied, submit a form rendered before a context transition and verify rejection, then stop through the raw actor session.
4. Record command results, HTTP outcomes, browser evidence, and any environment adjustment.

### Fresh Edge host

1. Materialize the official AdonisJS Hypermedia starter at the recorded upstream revision. For the run below, the source was `https://github.com/adonisjs/starter-kits`, subdirectory `hypermedia`, commit `449d77cc25dd08e036f442d2d39b760d43ccfbd3`. From an empty parent directory, run `git clone https://github.com/adonisjs/starter-kits.git starter-kits`, `git -C starter-kits checkout 449d77cc25dd08e036f442d2d39b760d43ccfbd3`, then `cp -R starter-kits/hypermedia fresh-edge-host`. Confirm `fresh-edge-host` contains no Masquerade package or configuration before setup.
2. Set `PACKAGE_CHECKOUT` to the clean package checkout being tested, then build the exact package revision and copy its tarball into the fresh host as `native-session-package.tgz`. `tmp/` and `*.tgz` are ignored by Git, so a clean checkout has no tarball: follow the rebuild commands in [Fresh Edge integration](edge.md#fresh-edge-integration) and confirm the recorded SHA-256. A locally preserved tarball is equivalent only when its SHA-256 matches the record for the revision being tested. Record the artifact hash and lockfile result. Do not install a registry version or copy configuration from the native-session demo.
3. Follow [Install and configure](../../guide/setup.md) in order, using the tested host additions in step 5 to complete model fields, identity callbacks and policy; reuse the exact provider object in the raw and effective guards; set context enforcement to `enforce` for the covered forms; apply the generated migration; order middleware; and add minimal host-owned routes, UI, and data.
4. With fictional accounts, verify start, separate actor/effective identities, customer read, a reversible preference, sensitive-action denial, a stale form rejected after another tab changes context, and stop through the raw actor session. Use browser journeys, not API calls alone.
5. The checked-in patches record the host-owned additions made after package configuration for the tested journey. Use the [alpha fresh-host patch](fresh-alpha-edge-host.patch) for the [alpha baseline](../alpha-baseline.md) and later revisions, where configure wires `config/auth.ts` and `start/kernel.ts` itself; the [original fresh-host patch](fresh-edge-host.patch) applies only to source `7117345a94d6679d046b060b659bdb8bad40679b`. From the host root, after installing the exact artifact and running `node ace configure adonisjs-masquerade --namespace=fresh_edge --guard=web`, apply the matching patch, for example `patch -p1 < "$PACKAGE_CHECKOUT/docs/maintainers/adoption-validation/fresh-alpha-edge-host.patch"`; then run the generated migrations and typecheck before the browser journey. The patch is a reproducibility aid, not package-provided host UI.
6. If a setup gap appears, correct the public setup guide and repeat the material setup and journey from a fresh starter copy and database.

### Additional clients

Validate a client only when its setup path and runnable example exist at the candidate revision. Use a fresh host for each client; follow that client's setup and documentation; exercise the full journey in its browser when it has a browser UI. Record unsupported and untested paths explicitly. A recipe harness or already-wired demo is supporting evidence, not fresh-host evidence.

## Completion criteria

A path is **not delivered** when its example is absent from the tested revision, and **not run** when it exists but has not been exercised. A path passes only when its clean setup and required real-browser journey succeed. A material blocker leaves that path incomplete until resolved and rerun. Do not infer success for unmerged work from its pull request description. External participants and study recruitment are out of scope.

## Run index

- [Native-session demo and fresh Edge host](edge.md)
- [Fresh Inertia Vue host](vue.md): separate, unmerged example candidate and the exact main package artifact.
