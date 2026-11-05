# React Inertia support example

This private AdonisJS 7 app starts from the [official React starter kit at commit `754164f`](https://github.com/adonisjs/react-starter-kit/commit/754164fdfb147323b3a4b007b7763c90c54c27b0). It uses React 19, Inertia 2, native session auth, Lucid SQLite and SSR disabled. `pnpm-lock.yaml` records the resolved versions; notably AdonisJS Core 7.6.0, Inertia adapter 4.2.0, React 19.3.1 and Inertia React 2.3.29. The local package dependency points at the tarball built from this repository.

From a clean checkout with Node 24 and pnpm:

```sh
nvm use
pnpm install
pnpm build
pnpm pack:fixture
cd examples/inertia-react
pnpm install --no-frozen-lockfile
cp .env.example .env
node ace generate:key
node ace migration:run
node ace demo:seed
pnpm dev
```

Open <http://localhost:3371/login> and sign in with `operator@example.test` / `demo-operator-2026`. The fictional eligible customers are `customer-one@example.test` and `customer-two@example.test`. The demo credentials and database stay local. `node ace demo:seed` refreshes only the three fictional records; `node ace demo:reset` removes them. Tests use `tmp/test.sqlite3`, separate from the seeded development database at `tmp/db.sqlite3`. Stop with Ctrl+C.

The package specifier `@kevinjohn/adonisjs-masquerade` resolves to `../../tmp/native-session-package.tgz`. Repack and reinstall after changing the package. Masquerade is not published to a package registry; to use a release, install its GitHub release tarball as the [setup guide](../../docs/guide/setup.md#generate-the-starter-files) shows. The application imports only public package subpaths and provider types.

The workspace uses the raw `web` guard for start, stop and status. Starting support mode requires choosing an access level: `View only` is preselected, and the host policy decides whether a `Can edit` request is accepted. The level stays fixed for the account-wide mode and appears in the customer and workspace banners. The customer route uses `web_effective`, its admitted view and customer Bouncer permissions. Every covered form owns a hidden context token created with that form, including while idle. Shield's XSRF cookie protects CSRF independently. After transitions the destination page clears Inertia history, and the client revalidates restored or visible pages before displaying customer data. Once this tab has shown a support page, Back, Forward and browser-cache restoration return to the raw workspace, including from public pages after logout. This conservative behavior prevents an old customer view from remounting between navigation and admission. A rejected old form opens a recovery page with a host-owned explanation; it is never replayed with a new token. If a transition returns 503, inspect raw status before creating another action.

Run the focused integration gate from the repository root with `pnpm test:inertia-react`. Inside this app, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test functional` and `pnpm test:browser` are available. Browser tests require Playwright Chromium from the Japa browser client. The automated suite checks keyboard submission, named inputs, focus on recovery, live status and 320px horizontal overflow in Chromium; it does not certify screen-reader behavior, other browser engines or all assistive technology combinations.

Login validates required email/password fields before credential lookup. Malformed input returns
field errors; valid-shaped incorrect credentials keep the ordinary sign-in failure message.
