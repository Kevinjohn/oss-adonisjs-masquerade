# Masquerade for AdonisJS

[![checks](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/workflows/checks.yml)
[![Node.js 24+](https://img.shields.io/badge/node-%3E%3D24-339933)](package.json)
[![AdonisJS 7](https://img.shields.io/badge/AdonisJS-7-5a45ff)](https://adonisjs.com)

> Pre-release. Installed from GitHub releases; not on npm.

## What you get

Masquerade lets an authorised operator use the application as another account for a fixed time
while staying signed in as themselves. It never logs in as the target or creates a target
credential.

- Your host's `canMasquerade` callback approves each actor and target.
- Access is read-only by default; edit access requires explicit approval via `canEdit`.
- Sensitive routes stay blocked while a mode is active.
- The mode expires automatically and can be stopped explicitly.
- Native AdonisJS sessions and opaque access tokens are supported.

## Install

Masquerade is distributed as a GitHub release tarball. Install it in your AdonisJS application:

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-masquerade/releases/download/v0.7.1/kevinjohn-adonisjs-masquerade-0.7.1.tgz
node ace configure @kevinjohn/adonisjs-masquerade --namespace=my_app --guard=web
```

The [setup guide](docs/guide/setup.md) also explains how to pack and install the current checkout.

## What configure writes

Configure creates the Masquerade config, native provider, shared user provider and one Lucid migration per table.
It registers the two providers and Ace commands in `adonisrc.ts`. Use `--control-routes` to draft
control routes and separate rate limiters, then review and import the drafts in the host.

## Configuration

Implement account incarnation, security stamp, account eligibility and `permissions` in the
scaffold. Reuse the same user provider for the raw guard and native adapter. Add the effective guard.
Mount `@kevinjohn/adonisjs-masquerade/masquerade_context_middleware` in the `router.use([...])` stack
of `start/kernel.ts`, after Auth initialization and before silent authentication: it reads
`ctx.auth`, so the application mounts it.
Keep the controls on the raw guard with CSRF protection. See [setup](docs/guide/setup.md).

## Usage

Use the effective Auth guard for customer-facing routes. Mark routes that allow edits or must remain
blocked during masquerade. Replace the lazily imported controllers below with your host application's controllers:

```ts
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { allowMutation, sensitive } from '@kevinjohn/adonisjs-masquerade/http'

const OrdersController = () => import('#controllers/orders_controller')
const AccountController = () => import('#controllers/account_controller')

const asCustomer = middleware.auth({ guards: ['web_effective'] })

router.get('/orders', [OrdersController, 'index']).use(asCustomer)
router.post('/orders/:id/notes', [OrdersController, 'note']).use(allowMutation()).use(asCustomer)
router.post('/account/password', [AccountController, 'update']).use(sensitive()).use(asCustomer)
```

The markers also have a named-middleware form. Configure registers it in `start/kernel.ts` as
`masquerade`; mark a route with `.use(middleware.masquerade({ marker: 'sensitive' }))` or
`{ marker: 'allowMutation' }`. Keep the name `masquerade`: under another name the context middleware
cannot see the marker, so the marker middleware fails the request instead of letting it through.

## Registering callbacks from a provider

`config/masquerade.ts` may leave out `authority` and `permissions`, so it does not import application
services. An application provider registers them instead, through `MasqueradeCallbackRegistration`, in its
`boot()` method:

```ts
// providers/package_callbacks_provider.ts
import type { ApplicationService } from '@adonisjs/core/types'
import { MasqueradeCallbackRegistration } from '@kevinjohn/adonisjs-masquerade'

export default class PackageCallbacksProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    const callbacks = await this.app.container.make(MasqueradeCallbackRegistration)
    callbacks.register(async () => {
      const { nativeAdapter, masqueradePermissions } =
        await import('#services/auth/masquerade_authority')
      return { native: nativeAdapter, permissions: masqueradePermissions }
    })
  }
}
```

List this provider in `adonisrc.ts` before `@kevinjohn/adonisjs-masquerade/masquerade_provider`,
which builds the runtime at boot. The factory runs once, when Masquerade first needs the callbacks.
Masquerade binds the registered `native` as `NativeAdapter`, and the runtime uses its
`authority` when the config has none. An application that binds `NativeAdapter` itself keeps
working. A value supplied in both places, a second registration, or a registration after the
runtime was built throws.

### Account Kit middleware

Register `AccountKitBlocker` from `/account-kit/managed_blocker_middleware` in the router stack after Auth
initialization and before silent authentication. Apply `AccountKitAccountBlocker` only to named
host-owned account route groups behind the raw guard. Keep logout and CSRF routes outside that
group. See [Account Kit setup](docs/guide/account-kit.md#install-the-provider-and-blocker).

## Errors

Import `errors` from `@kevinjohn/adonisjs-masquerade` and check a request or setup exception with
`instanceof errors.E_MASQUERADE_…`. JSON clients can continue matching the same stable `code`.
See [Recover from errors](docs/guide/errors.md) for the constructors and response contract.

## Supported AdonisJS versions

AdonisJS 7 and Node 24 are supported.

|                         | Every pull request | Weekly, matching PRs, and manual runs   |
| ----------------------- | ------------------ | --------------------------------------- |
| Node.js                 | 24                 | 24                                      |
| AdonisJS core           | locked version     | lowest supported (7.0.0) and latest 7.x |
| Lucid                   | locked version     | lowest supported and latest 22.x        |
| SQLite (better-sqlite3) | yes                | yes                                     |
| PostgreSQL 16           | yes                | yes                                     |

## Documentation

The [four released starter apps](https://github.com/Kevinjohn/oss-adonisjs-starter-examples/tree/v0.17.0/apps) show Masquerade with Account Kit and Access Control. Follow the [shared integration recipes](https://github.com/Kevinjohn/oss-adonisjs-starter-examples/tree/v0.17.0/docs/cookbook) for the tested route and guard setup.

- [Add support mode to a new AdonisJS app](docs/recipes/starter-kit.md): tested, step by step
- [Recipes by task](docs/recipes/index.md) and [terms](docs/guide/glossary.md)
- [Getting started](docs/guide/getting-started.md)
- [Install and configure](docs/guide/setup.md)
- [Usage](docs/guide/usage.md)
- [Security model](docs/guide/security.md)
- [Troubleshooting](docs/guide/troubleshooting.md)
- [API reference](docs/reference/README.md)
- [Masquerade notes for coding agents](README-AGENTS.md)

## Contributing

Bug reports and documentation fixes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

<a id="license"></a>

## Licence

[MIT](LICENSE.md)

## User story catalogue

See the [source-reviewed user story catalogue](user-stories/README.md) for capability coverage and code-backed action flows.
