# Masquerade with Account Kit: API example

This app is Account Kit's
[API example](https://github.com/Kevinjohn/oss-adonisjs-account-kit/tree/v0.3.1/examples/api)
at `v0.3.1`, with Masquerade added through its `access_tokens` strategy and raw `api` guard.
It runs on the official AdonisJS API starter at
[`adonisjs/starter-kits` revision `46d235932e3eb6472a16b740fa0b47b5f69fc6fc`](https://github.com/adonisjs/starter-kits/tree/46d235932e3eb6472a16b740fa0b47b5f69fc6fc/api).
Account Kit's original controllers, admission rules, notifications and test harness remain here;
its README explains those flows and their demo-only limits.

## What this example adds

| File                                                                        | Shows                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `config/masquerade.ts`                                                      | Account Kit authority, token ability, operator policy and target admission                  |
| `app/services/masquerade_user_provider.ts`, `config/auth.ts`                | One shared token provider, raw `api` and `api_effective` guards                             |
| `app/services/account_kit_guard.ts`                                         | Account Kit's managed `access_tokens` guard                                                 |
| `app/services/masquerade_operators.ts`, `start/env.ts`                      | Operators from `MASQUERADE_OPERATOR_EMAILS`                                                 |
| `app/services/masquerade_store.ts`                                          | Lucid control store on the current connection                                               |
| `app/middleware/account_kit_actor_admission_middleware.ts`                  | Actor admission before mode resolution on named controls and business routes                |
| `adonisrc.ts`, `start/kernel.ts`, `providers/masquerade_native_provider.ts` | Providers, Account Kit blocker and context middleware                                       |
| `start/masquerade_routes.ts`, `start/masquerade_limiter.ts`                 | JSON status/start/stop, separate per-operator limits, effective account and sensitive route |
| `database/migrations/1800000001003_create_masquerade_tables.ts`             | Masquerade's tables after the predecessor's migrations                                      |

`node ace configure @kevinjohn/adonisjs-masquerade --namespace=starter --guard=api`
generated the starting files without a banner or form controller. Its scaffold uses session auth;
this app replaces that authority and user provider with the documented Account Kit token variant.
Account Kit supplies account activity, restrictions and credential revisions. The adapter requires
the `masquerade` token ability (`*`, issued by this example's login, includes it).

The demo's business routes select `api_effective`; status/start/stop select raw `api`. The original
Account Kit account endpoints continue to manage the authenticated actor. They are not target
business endpoints. The inherited `/api/v1/reports` endpoint remains an empty, raw-actor fixture;
add real target business data behind an explicitly effective guard. Masquerade does not mint a target token. This example keeps Account Kit's
strategy switches for its existing harness; the Masquerade demo supports `access_tokens` only.

## Install and run

Use Node 24 and pnpm 11.23.0. From the Masquerade repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir examples/with_account_kit/api kit:pack
cd examples/with_account_kit/api
pnpm install --no-frozen-lockfile
cp .env.example .env
node ace generate:key --force
node ace codegen
node ace migration:run
pnpm dev
```

`kit:pack` builds Masquerade from this checkout into ignored `vendor/`. Account Kit comes from its
`v0.3.1` GitHub release. Repacking changes the archive's checksum, so refresh the install without a
frozen lockfile. The API listens at <http://localhost:3333> by default. OAuth settings are inert
placeholders; core authentication does not need an OAuth account.

## Make yourself an operator

Set `MASQUERADE_OPERATOR_EMAILS` in `.env` to a comma-separated list of emails, then restart.
Missing or empty means nobody is an operator. The operator and target must also satisfy Account
Kit's account activity and admission rules. Operator status does not grant admission or Account
Kit's separate owner role, and operators cannot be targets.

For a local demo, create two verified, admitted accounts in `node ace repl` (use a disposable
SQLite database and replace these passwords). These statements seed the same invitation evidence
and approval required by this example's admission configuration:

```js
const User = (await import('#models/user')).default
const db = (await import('@adonisjs/lucid/services/db')).default
const { DateTime } = await import('luxon')
for (const email of ['operator@example.test', 'customer@example.test']) {
  const user = await User.create({
    email,
    password: 'DemoPassword123!',
    emailVerifiedAt: DateTime.utc(),
  })
  const now = DateTime.utc().toJSDate()
  await db.table('account_admissions').insert({
    user_id: user.id,
    invited_email: email,
    invitation_source: 'operator',
    invitation_recorded_at: now,
    approval_status: 'approved',
    approval_decided_at: now,
    created_at: now,
    updated_at: now,
  })
  console.log(email, user.id)
}
```

Use the printed customer ID below. With `MASQUERADE_OPERATOR_EMAILS=operator@example.test`:

1. `POST /api/v1/auth/login` with JSON `{"email":"operator@example.test","password":"DemoPassword123!"}`.
   Keep `data.token` and send `Authorization: Bearer <token>` on all following requests.
2. `GET /masquerade` returns the idle state and `contextToken`.
3. `POST /masquerade/start` with JSON `{"targetId":"<customer ID>"}` and
   `X-Masquerade-Context: <idle contextToken>`. The response contains the new active context.
4. `GET /api/v1/masquerade/account` now returns the customer's ID and email using the same bearer token.
5. `POST /api/v1/masquerade/sensitive` with the active context header returns
   `403 E_MASQUERADE_ACTION_BLOCKED`, with `blockedBy: "sensitive"`.
6. `POST /masquerade/stop` with the active context header restores the operator. Read the effective
   account and status again to see the operator and idle state.

A start defaults to view-only. `canEdit` permits an eligible pair to request `"access":"edit"`,
but this demo marks no route `allowMutation()`. Sensitive routes remain blocked in either mode.
Unsafe effective requests require the current context header, including while idle. Missing
context returns 428 and stale context returns 409. Refresh the state and initiate a fresh action;
do not automatically replay the old request. Bearer requests use Account Kit's existing CSRF
configuration, which enables Shield CSRF only for its session strategy.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
HOST=127.0.0.1 LIMITER_STORE=memory pnpm test
```

Run code generation and migrations first, as in the setup above. The copied Account Kit suite
expects loopback and the in-memory limiter. The functional Masquerade spec exercises bearer login,
start, effective identity, sensitive refusal, stop, non-operator and operator-target refusals,
admission protection and token capability enforcement. No browser is needed.
