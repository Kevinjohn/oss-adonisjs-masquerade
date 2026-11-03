# Native session and access-token demo

This AdonisJS 7 hypermedia fixture is based on the official starter kit at commit
[`449d77c`](https://github.com/adonisjs/starter-kits/commit/449d77cc25dd08e036f442d2d39b760d43ccfbd3).
It consumes the built package tarball through native session and opaque access-token
authentication, Bouncer, Edge, controllers, middleware and a real Lucid store on SQLite or
PostgreSQL. The browser support workspace demonstrates session auth; the bearer walkthrough below
uses the same seeded operator and account-wide mode. Demo accounts and test credentials are
fictional.

## One-command demo

Prerequisites: Node.js 24 and pnpm. From the repository root, run:

```sh
nvm use
pnpm demo
```

The launcher installs the root dependencies from the frozen lockfile, builds and packs this
checkout, installs the local tarball using the example's integrity procedure, creates `.env` and
an application key only when needed, runs SQLite migrations and the guarded fictional seed, then
starts the app on loopback. It defaults to <http://127.0.0.1:3333>; set `PORT` in this example's
`.env` to choose another free local port. It refuses production or non-SQLite configuration and
preserves existing settings, keys and unrelated example data. Stop with Ctrl+C.

Sign in with the fictional local operator account:

| Account  | Email                   | Password             |
| -------- | ----------------------- | -------------------- |
| Operator | `operator@example.test` | `demo-operator-2026` |

From the dashboard, open the support workspace, choose a customer, enter a reason, and choose
**View only** or **Can edit** before starting support mode. View-only mode lets you read the
customer's email and preference; edit mode also lets you change the reversible email-update
preference. Return to the workspace and stop support mode when finished.

## Bearer API lifecycle

The bearer API uses the seeded operator and customers from the running demo. Keep the server from
`pnpm demo` running, open a second terminal at the repository root, and issue one short-lived
token. `demo:token` requires the demo accounts to exist; it does not seed or modify their flags.
It refuses non-development/test environments, non-SQLite databases, missing or ineligible demo
accounts, and creates a token that expires after one hour with only the `masquerade` ability. The command prints
JSON to stdout. Capture it directly in a shell variable; do not paste the value into a file or
share terminal logs containing it.

This walkthrough starts from idle mode. `pnpm demo` preserves account-wide mode from an earlier
run. Before issuing a token, inspect the current mode at `/support`; if it is active, stop it
deliberately from that workspace and confirm it is idle. The commands below do not clear or
replace an active target.

```sh
nvm use
cd examples/native-session

BASE_URL=http://127.0.0.1:3333
TOKEN_DATA=$(node ace demo:token)
TOKEN=$(printf '%s' "$TOKEN_DATA" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).token))')
CUSTOMER_ID=$(printf '%s' "$TOKEN_DATA" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).customers[0].id))')
printf 'Selected seeded customer id: %s\n' "$CUSTOMER_ID"
```

The JSON lists the seeded customer IDs in a stable order. The first one is selected here; the
command discovers the ID from the CLI output instead of assuming a database sequence. Read the
idle context, start the mode, and save the context returned by that transition:

```sh
IDLE_JSON=$(curl --fail-with-body -sS "$BASE_URL/api/masquerade" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/json')
IDLE_CONTEXT=$(printf '%s' "$IDLE_JSON" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).contextToken))')

START_BODY=$(printf '%s' "$TOKEN_DATA" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);process.stdout.write(JSON.stringify({targetId:d.customers[0].id,reason:"Local bearer support demo"}))})')
START_JSON=$(curl --fail-with-body -sS -X POST "$BASE_URL/api/masquerade/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "X-Masquerade-Context: $IDLE_CONTEXT" \
  --data "$START_BODY")
ACTIVE_CONTEXT=$(printf '%s' "$START_JSON" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).contextToken))')
```

Read the effective customer route. In another browser window already signed in as the seeded
operator, refresh `/support` to see the same account-wide mode and target. The bearer route keeps
the operator as actor and returns the customer as the effective identity; it does not attach the
token to the customer.

```sh
curl --fail-with-body -sS "$BASE_URL/api/support/customer" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/json'
```

Stop with the context saved from the successful start, then revoke the bearer token through the
native API logout route. Stop first so the account-wide mode is closed before revoking this
credential.

```sh
curl --fail-with-body -sS -X POST "$BASE_URL/api/masquerade/stop" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "X-Masquerade-Context: $ACTIVE_CONTEXT" \
  --data '{}'

curl --fail-with-body -sS -X POST "$BASE_URL/api/logout" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data '{}'

unset TOKEN_DATA TOKEN CUSTOMER_ID IDLE_JSON IDLE_CONTEXT START_BODY START_JSON ACTIVE_CONTEXT
```

If an unsafe request returns 409 or 428, stop and deliberately rebuild the action from a fresh
status or page; never replace its context value and replay the old intent. A 503 may leave a
control result uncertain: check status before choosing a new action. Revoking a token invalidates
only that credential; another valid session or token with the required ability continues to see
the shared mode until it is explicitly stopped or a global security-stamp change invalidates it.
Do not retry with a newly issued token as a substitute for resolving the current mode. Avoid curl
verbose mode, which would print the bearer credential. The token expires after one hour. After the
demo, remove the seeded accounts with `node ace demo:reset`; it also removes their access tokens,
remember-me credentials, mode rows, and audit events while preserving unrelated account data.

## Local setup

Prerequisites: Node.js 24 and pnpm. From a clean repository checkout, prepare the package tarball
from this checkout before installing the example, then set up and start the SQLite app:

```sh
nvm use
pnpm install
pnpm build
pnpm pack:fixture

cd examples/native-session
cp .env.example .env
```

Before installing, refresh the single local tarball integrity entry in the example lockfile to
match the package you just packed. This keeps the resolved dependency versions unchanged:

```sh
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const lockPath = 'pnpm-lock.yaml'
const lock = await readFile(lockPath, 'utf8')
const tarball = await readFile('../../tmp/native-session-package.tgz')
const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
const entry = /( {2}'@kevinjohn\/adonisjs-masquerade@file:\.\.\/\.\.\/tmp\/native-session-package\.tgz':\n {4}resolution: \{integrity: )sha512-[A-Za-z0-9+/=]+(, tarball: file:\.\.\/\.\.\/tmp\/native-session-package\.tgz\s*\})/g
if ([...lock.matchAll(entry)].length !== 1) throw new Error('Expected one local package entry in pnpm-lock.yaml')
await writeFile(lockPath, lock.replace(entry, `$1${integrity}$2`))
NODE

pnpm install --frozen-lockfile
node --input-type=module <<'NODE'
import { readFile, writeFile } from 'node:fs/promises'

const path = '.env'
const env = await readFile(path, 'utf8')
await writeFile(path, env.replace(/^APP_URL=.*$/m, 'APP_URL=http://127.0.0.1:3333'))
NODE
node ace generate:key
node ace migration:run
node ace demo:seed
pnpm dev
```

The example installs the package tarball packed from this checkout. Its local integrity entry
changes when the tarball is rebuilt; the command above refreshes only that entry and keeps all
locked dependency versions unchanged.

Open <http://localhost:3333>, then sign in with one of these local-only credentials:

| Account      | Email                       | Password                 | Demo capability                                   |
| ------------ | --------------------------- | ------------------------ | ------------------------------------------------- |
| Operator     | `operator@example.test`     | `demo-operator-2026`     | Can start masquerade; cannot mutate customer data |
| Customer one | `customer-one@example.test` | `demo-customer-one-2026` | Active customer; can mutate demo data             |
| Customer two | `customer-two@example.test` | `demo-customer-two-2026` | Active customer; can mutate demo data             |

These reserved accounts are for local demonstration only. Signup creates ordinary non-operator
accounts. `node ace demo:seed` can be run again safely: it refreshes these three addresses and does
not remove other accounts. To remove only these accounts, their access tokens, remember-me tokens,
masquerade rows and audit events, run `node ace demo:reset`. Both commands require `NODE_ENV` to be
`development` or `test` and the local SQLite database; they refuse production and PostgreSQL.
Reset does not drop tables or wipe unrelated accounts. Stop the server with Ctrl+C.

`node ace generate:key` creates a unique application key in your local `.env`. The fixed keys in
`.env.test` belong only to repeatable tests and are not suitable for an interactive app.

The authenticated dashboard links to `/support`. Sign in as the seeded operator, choose a customer,
enter a reason, and choose **View only** or **Can edit** before starting support mode. The workspace
keeps the signed-in operator distinct from the effective customer, shows the selected access level,
fixed deadline and account-wide scope, and offers a stop control.
The customer page reads that customer's email and demo email-update preference. Changing the
preference is reversible and uses the customer's Bouncer permission; the operator's own permission
does not carry over. The sensitive-action example is blocked during support mode. Ordinary signup
accounts can view the support entry but cannot start mode. The functional suite covers the
dashboard response, logout redirect, full support journey, and session and token recovery paths.

Forms include Shield CSRF and the context token captured when they were rendered. If another tab
or session changes mode, an old form returns a context-changed page; return to `/support` and
build a fresh action from the current page. A 503 after a control attempt may mean the outcome is
unknown: check `/support` status before acting again. The raw operator workspace remains available
if customer admission fails, so a valid operator can still inspect and stop mode. The browser JSON
client continues to use session-authenticated `/masquerade` controls. Bearer clients use
`/api/masquerade` and `/api/logout` as shown in the bearer walkthrough.

Both production error templates also render through the registered marketing layout; a functional
regression test rejects unprocessed layout tags in their HTML. Error layouts also support requests
that have not run the router auth/session middleware: unknown URLs retain HTTP 404 and render the
normal not-found page. The functional suite exercises this real HTTP path with production status
rendering enabled, alongside direct rendering of both error templates without auth/session data.

Flash alerts reveal after 80 ms and dismiss after five seconds by default. Set `autoDismiss: false`
on `@alert.root` to keep an alert visible until its dismiss action is called.

## Validate the packed consumer

The consumer harness runs `pnpm build` and `pnpm pack:fixture` itself and stops if either fails, so
it never tests a tarball left over from an earlier build. It installs that tarball into isolated
applications outside the checkout. `--package=<path>` installs the given tarball as is, with no
rebuild, for example to compare an earlier release; that tarball need not match the current
source. It runs the declared
peer floors and newest compatible versions against SQLite and PostgreSQL 16, and reports the
package SHA-256, resolved dependencies and suite counts. It stops only a PostgreSQL server it
started. To use an already managed server, set `CONSUMER_PG_EXTERNAL=1` and `DB_HOST`, `DB_PORT`,
`DB_USER`, `DB_PASSWORD` and `DB_DATABASE`.

Useful runs from the repository root:

```sh
pnpm test:consumer
```

Each profile validates the packed root exports and optional-import boundary in a fresh process,
executes the native configure command in a host copy, typechecks all generated files against the
real conventional User model, then runs fixture lint/build and database-specific typechecks and
HTTP suites. Installed package peer manifests are checked independently of overrides. The floor
profile pins `@adonisjs/vite` to 6.0.1 because 6.0.2 requires Core 7.5; package peer floors remain
unchanged.

To run the app tests after installing the example dependencies as shown above:

```sh
cd examples/native-session
pnpm lint
pnpm typecheck
SESSION_DRIVER=memory pnpm test functional
SESSION_DRIVER=memory pnpm test:report
pnpm test:credentials
```

The browser suite uses the Japa browser client already included in the example. Install its pinned
Chromium build once, then run the browser suite twice on an isolated local port to check test
cleanup and session independence:

```sh
cd examples/native-session
pnpm dlx playwright@1.60.0 install chromium
HOST=127.0.0.1 PORT=3391 SESSION_DRIVER=memory pnpm test:browser
HOST=127.0.0.1 PORT=3391 SESSION_DRIVER=memory pnpm test:browser
pnpm test:ui
```

On a clean Linux runner, install the matching browser and system libraries with
`pnpm dlx playwright@1.60.0 install --with-deps chromium`. The browser suite drives the rendered
login, support, customer and recovery forms with fictional test accounts. It covers keyboard form
submission, fixed expiry, focused customer intent, stale-tab rejection, separate operator session
cookies, sensitive-action denial, unavailable-store recovery and a narrow viewport. Captures are
written to the ignored `tmp/browser/` directory. The suite does not cover every browser, assistive
technology, theme override, contrast mode or zoom setting; do a manual pass for keyboard start/stop
and recovery, screen-reader status announcements, visible focus, 200% zoom and narrow layouts.

Useful focused consumer runs from the repository root:

```sh
pnpm test:consumer --profile=floor --database=sqlite
pnpm test:consumer --profile=latest --database=pg
pnpm test:consumer --package=tmp/native-session-package.tgz
```

The functional suite covers identity, context, action, token and session transport, and
alternate-identifier behavior. The original numeric User integration exercises the complete
provider/effective-guard facade, raw actor, lazy Bouncer, global silent authentication and real
HTTP controls. `Member` uses `support_accounts.account_key` with application-assigned string and
UUID identifiers and no `id` property. Its separate host routes prove native provider canonical
IDs through start/status/resolve/stop and SQL persistence; they do not configure a second global
effective facade.

Functional/report tests use native memory-backed session storage, matching the Japa session
plugin at the supported floor; the real HTTP cookie-jar cases still prove session transport,
credential isolation and logout. The separate credential suite uses the native cookie store,
remember-me tokens and an actual one-second cookie age. It compares raw and effective routes
before expiry and after remember-me recovery, checks an expired session without remember-me is
rejected, and verifies starting a mode neither rotates the actor session nor creates a target
remember token. The short age is enabled only by `NATIVE_CREDENTIALS_SESSION=true` through
`test:credentials`.

For PostgreSQL direct runs, set `DB_CLIENT=pg` plus the connection variables above. `DB_SCHEMA`
optionally isolates fixture tables. SQLite remains the normal local default.

The raw bearer status/start/stop controls, token logout, and effective customer read are ordinary
demo routes. Other raw-business, alternate-guard, and mixed-guard routes remain test-only
adversarial cases, not recommended host wiring. Report mode runs in a separate process so it cannot
weaken the enforce-mode cases.

The example keeps ordinary host wiring in `config/masquerade.ts`, `config/auth.ts`,
`start/masquerade_control_routes.ts`, `start/demo_routes.ts`, the bearer API routes, and
`start/routes.ts`: Lucid storage, native auth routes, raw-guard session and bearer controls, the
effective bearer customer read, and the browser adapter. HTML start/stop forms use the same service
and actor-keyed limiter definitions as the session JSON routes. The
form and deliberate identity, alternate-guard,
mutation and concurrency probes live in `start/test_routes.ts` and `start/member_routes.ts`;
AdonisJS preloads them only when `NODE_ENV=test`, where the original test URLs remain available.
Set `NODE_ENV=test` when running `node ace masquerade:routes` to include those routes in the
coverage report. `app/services/masquerade_fixture_boundary.ts` and
`app/services/fixture_control_store.ts` hold test-only failure injection and diagnostics. The
admitted-stop-form endpoint is a concurrency probe and is not registered for an interactive app.

The start and stop controls each use a separate `@adonisjs/limiter` budget keyed by the raw actor.
Both allow 10 requests per minute by default; `MASQUERADE_START_REQUESTS` and
`MASQUERADE_STOP_REQUESTS` override those counts. The fixture uses AdonisJS's process-local
memory store, so counters reset on restart and are not shared between app processes. Use a shared
store for a multi-process deployment. Tests select the memory store, lower the start budget to two,
and clear limiter state between cases. Authentication and Shield CSRF middleware still run before
the route limiters. See the [official rate-limiting guide](https://docs.adonisjs.com/guides/security/rate-limiting)
for supported stores and middleware behavior.
