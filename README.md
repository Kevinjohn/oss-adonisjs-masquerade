# Masquerade for AdonisJS

[![checks](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/workflows/checks.yml)
[![Node.js 24+](https://img.shields.io/badge/node-%3E%3D24-339933)](package.json)
[![AdonisJS 7](https://img.shields.io/badge/AdonisJS-7-5a45ff)](https://adonisjs.com)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange)](#status)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE.md)

**See your app exactly as another user sees it, without their password.**

A customer reports a problem you can't reproduce from your own account. Masquerade lets an
authorized user, such as an admin, use the application as that customer for a fixed time while
staying signed in as themselves. Also known as user impersonation.

![The customer view with a support banner naming the operator, the customer, the access level and the deadline.](docs/assets/walkthrough/support_customer_active.png)

## Why use it

- **You decide who can view whom.** Your `canMasquerade` policy approves each pair, on every request.
- **No credential for the customer.** The admin stays signed in; the customer never logs in.
- **Read-only by default.** Edits need **Can edit** and your `canEdit` policy; `sensitive()`
  routes stay blocked.
- **Time-boxed.** 15 minutes by default, one hour at most, with an explicit stop.
- **Sessions and access tokens.** Works with native AdonisJS sessions and opaque access tokens.

## Install

Masquerade needs Node.js 24+ and AdonisJS 7. Alpha builds are GitHub prereleases:

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-masquerade/releases/download/v0.1.1-alpha/adonisjs-masquerade-0.1.1-alpha.tgz
node ace configure adonisjs-masquerade --namespace=my_app --guard=web
```

[Install and configure](docs/guide/setup.md) covers the peers and the generated files.

## Quick win

Routes on the effective guard run as the customer. Mark the ones that need care:

```ts
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { allowMutation, sensitive } from 'adonisjs-masquerade/http'

const asCustomer = middleware.auth({ guards: ['web_effective'] })

// Readable as the customer
router.get('/orders', [OrdersController, 'index']).use(asCustomer)

// Editable when the mode was started with Can edit
router.post('/orders/:id/notes', [OrdersController, 'note']).use(allowMutation()).use(asCustomer)

// Rejected before the handler runs while any mode is active
router.post('/account/password', [AccountController, 'update']).use(sensitive()).use(asCustomer)
```

## Try it

From this checkout, with Node 24 and pnpm, run `nvm use` and `pnpm demo`, then open
<http://127.0.0.1:3333>. The [demo instructions](examples/native-session/README.md#one-command-demo)
list the fictional accounts, and the [walkthrough](docs/guide/walkthrough.md) shows the journey.

## Status

Early alpha: expect breaking changes before 1.0. It has not had an independent security review,
so do not rely on it in production yet.

## Documentation

[Getting started](docs/guide/getting-started.md) · [Usage](docs/guide/usage.md) ·
[Access tokens](docs/guide/access-tokens.md) · [Security](docs/guide/security.md) ·
[Troubleshooting](docs/guide/troubleshooting.md) · [All guides](docs/README.md) ·
[API reference](docs/api-reference.md)

[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Changelog](CHANGELOG.md) ·
[MIT licence](LICENSE.md)
