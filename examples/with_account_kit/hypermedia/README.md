# Masquerade with Account Kit: Hypermedia example

This app is Account Kit's
[Hypermedia example](https://github.com/Kevinjohn/oss-adonisjs-account-kit/tree/v0.3.2/examples/hypermedia)
at `v0.3.2`, with Masquerade added. An operator can act as another account, see the app as that
account does, and stop. It runs on the official AdonisJS Hypermedia starter at
[`adonisjs/starter-kits` revision `46d235932e3eb6472a16b740fa0b47b5f69fc6fc`](https://github.com/adonisjs/starter-kits/tree/46d235932e3eb6472a16b740fa0b47b5f69fc6fc/hypermedia).
Everything Account Kit's README describes still applies.

## What this example adds

| File                                                                                  | Shows                                                                                          |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `config/masquerade.ts`                                                                | `accountKitAuthority` and the policy: operators may act as any account that is not an operator |
| `app/services/masquerade_operators.ts`, `start/env.ts`                                | Operators come from `MASQUERADE_OPERATOR_EMAILS`                                               |
| `app/services/account_kit_guard.ts`, `config/session.ts`                              | Account Kit's managed view of the `web` session guard, on the database session store           |
| `app/services/masquerade_store.ts`                                                    | Masquerade's Lucid store on the current database connection                                    |
| `config/auth.ts`, `start/kernel.ts`, `adonisrc.ts`                                    | The `web_effective` guard, the context and status middleware, and the providers                |
| `start/masquerade_routes.ts`, `app/controllers/masquerade_*.ts`                       | The operator page and the start and stop forms                                                 |
| `resources/views/pages/masquerade/accounts.edge`, `components/masquerade/banner.edge` | The operator page and the banner shown in the app layout                                       |
| `start/routes.ts`                                                                     | Password and email changes are `sensitive()`; logout stays on the raw guard                    |
| `app/middleware/session_revision_middleware.ts`                                       | Checks the operator's own session, not the account being viewed                                |
| `database/migrations/1792342558358_create_masquerade_tables.ts`                       | Masquerade's tables                                                                            |

`node ace configure @kevinjohn/adonisjs-masquerade --namespace=starter --guard=web --banner --form-controller`
generated the starting files. The adapter replaces the generated native authority, so the
generated `incarnation`, `securityStamp` and `isActive` callbacks are gone: Account Kit's account
state answers them. A mode is view only unless the operator chooses **Can edit**, and an edit still
needs a route marked `allowMutation()`; this example marks none.

## Install and run

Use Node 24 and pnpm 11.23.0. From the Masquerade repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir examples/with_account_kit/hypermedia kit:pack
cd examples/with_account_kit/hypermedia
pnpm install --no-frozen-lockfile
cp .env.example .env
pnpm exec node ace generate:key --force
pnpm exec node ace migration:run
PORT=3342 APP_URL=http://localhost:3342 pnpm dev
```

`kit:pack` builds Masquerade from this checkout into `vendor/`. Account Kit comes from its `v0.3.2`
GitHub release. The packed archive's checksum changes with every build, so the install does not
use a frozen lockfile.

## Make yourself an operator

Set `MASQUERADE_OPERATOR_EMAILS` in `.env` to a comma-separated list of email addresses, then
restart the app. Without it, nobody is an operator.

1. Create two accounts at `/signup`: one whose email is in the list, and another.
2. Sign in as the operator and open `/masquerade/accounts`.
3. Choose **Act as** for the other account. The dashboard now shows that account, with a banner
   saying who you are viewing as.
4. Try to change the password: it is refused while masquerading.
5. Choose **Stop masquerade** in the banner. You are back as yourself.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`tests/functional/masquerade.spec.ts` covers start, acting as the target, the refused sensitive
route, stop, a refused non-operator and a refused operator target.
`tests/browser/masquerade.spec.ts` starts, sees the banner and stops in Chromium.
