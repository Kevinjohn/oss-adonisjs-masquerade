# Inertia Vue support example

This private AdonisJS 7 application was scaffolded from the official [`adonisjs/starter-kits/inertia-vue`](https://github.com/adonisjs/starter-kits/tree/46d235932e3eb6472a16b740fa0b47b5f69fc6fc/inertia-vue) starter at commit `46d235932e3eb6472a16b740fa0b47b5f69fc6fc`. It uses native session authentication, Lucid SQLite, Inertia with Vue 3, and client rendering with SSR disabled. `pnpm-lock.yaml` records the resolved app dependencies. The package dependency points to a locally packed build of this checkout.

From a clean checkout, use Node 24 and pnpm:

```sh
nvm use
pnpm install
pnpm build
mkdir -p tmp
pnpm pack --out tmp/inertia-vue-package.tgz
cd examples/inertia-vue
pnpm install --no-frozen-lockfile
cp .env.example .env
node ace generate:key
node ace migration:run
node ace demo:seed
pnpm dev
```

Open <http://localhost:3378/login> and sign in as `operator@example.test` with password `demo-operator-2026`. The eligible fictional customers are `customer-one@example.test` and `customer-two@example.test`. All credentials and database records are local demo fixtures. `node ace demo:seed` refreshes those three reserved accounts; `node ace demo:reset` removes them. Stop the server with Ctrl+C.

To use a released alpha, check out its tag (for example `v0.1.0-alpha.1`) and build and pack it with the same commands. Do not use a registry dependency for this local example. The package specifier resolves to `../../tmp/inertia-vue-package.tgz`; repack and reinstall after changing or switching the package source.

The raw `web` guard owns login, logout, support status, and start/stop controls. The `web_effective` guard protects customer reads and mutations. Every unsafe form, including an idle start form, captures its context token when the form is created. Shield's CSRF token is independent. The app refreshes the customer page after transitions, encrypts Inertia history, revalidates restored or visible customer pages and the operator workspace, and never replays an old action with a refreshed token.

Choose **View only** or **Can edit** when starting support mode. View only is selected by default; edit access is available only to an operator whose host policy allows it.

The demo commands use `tmp/db.sqlite3`. Functional and browser tests use the separate `tmp/test.sqlite3`, so running the suites does not alter local demo accounts.

Run app checks from this directory with `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test functional`, and `pnpm test:browser`. From the repository root, `pnpm test:inertia-vue -- --no-browser` runs the local package build/pack, installs this fixture dependency, and runs the non-browser checks. The full root command also runs the Chromium suite. Browser coverage exercises Chromium and a 320px viewport; it does not certify screen-reader behavior, other browser engines, or every assistive-technology combination.
