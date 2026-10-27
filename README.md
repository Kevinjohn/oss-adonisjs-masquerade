# Masquerade for AdonisJS

[![checks](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE.md)
[![Node.js 24+](https://img.shields.io/badge/node-%3E%3D24-339933)](package.json)
[![AdonisJS 7](https://img.shields.io/badge/AdonisJS-7-5a45ff)](https://adonisjs.com)

**See your app exactly as another user sees it, without their password.**

A teammate says a page looks wrong, or a customer reports a problem you can't reproduce from your
own account. Asking for their password is not an option. Masquerade lets an authorized user, such
as an admin, open the application as that other user for a fixed time, while staying signed in as
themselves. This is also known as user impersonation.

![The customer view with a support banner naming the operator, the customer, the access level and the deadline.](docs/assets/walkthrough/support_customer_active.png)

## What you get

- **You decide who can view whom.** Your `canMasquerade` policy approves each pair, for example
  an admin and a member of their own team, and is rechecked on every request.
- **The admin stays the admin.** Login, logout and the start and stop controls keep using your
  existing session guard. The other user never signs in and no credential is created for them.
- **Your existing authorization still decides.** On business routes, `auth.user` is the other
  user, so your normal Auth and Bouncer checks apply. The two users' permissions are never
  combined.
- **Read-only by default, with a Can edit option.** Every mode starts view-only. An admin can
  choose **Can edit** when starting, and only if your `canEdit` policy approves that pair. Routes
  you mark `sensitive()` stay blocked either way.
- **Time-boxed and stoppable.** Every mode has a fixed deadline (15 minutes by default, one hour
  maximum) and an explicit stop.
- **Sessions and access tokens.** Works with native AdonisJS sessions and opaque access tokens.

## Quick win

After [setup](docs/guide/setup.md), choosing what support mode can do is a route change. Put
business routes on the effective guard, and mark the ones that need care:

```ts
import { allowMutation, sensitive } from 'adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'

router
  .get('/support/customer', [() => import('#controllers/demo_controller'), 'customer'])
  .as('demo.customer')
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/support/customer/preference', [
    () => import('#controllers/demo_controller'),
    'preference',
  ])
  .as('demo.preference')
  .use(allowMutation())
  .use(middleware.auth({ guards: ['web_effective'] }))

router
  .post('/support/customer/sensitive', [() => import('#controllers/demo_controller'), 'sensitive'])
  .as('demo.sensitive')
  .use(sensitive())
  .use(middleware.auth({ guards: ['web_effective'] }))
```

- The first route is readable as the other user.
- The second can be changed as the other user, when the mode was started with **Can edit**.
- The third is rejected before its handler runs whenever support mode is active.

## Try it

With Node 24 and pnpm, run the fictional demo from this checkout:

```sh
nvm use
pnpm demo
```

Open <http://127.0.0.1:3333> and sign in with the fictional operator account listed in the
[demo instructions](examples/native-session/README.md#one-command-demo). The
[walkthrough](docs/guide/walkthrough.md) follows the same support journey with screenshots.

## Status

Early alpha for local self-testing. Version `0.0.0` is not published to a registry; install from a
local build as described in the [setup guide](docs/guide/setup.md#generate-the-starter-files). The [baseline verification record](docs/maintainers/alpha-baseline.md) names the validated source
and local artifact.

## Documentation

- [Getting started](docs/guide/getting-started.md): choose the demo or integrate an existing app.
- [Install and configure](docs/guide/setup.md) and [use a support mode](docs/guide/usage.md).
- Clients: [JSON](docs/guide/clients/json.md), [Inertia React](docs/guide/clients/react.md),
  [Inertia Vue](docs/guide/clients/vue.md), [access tokens](docs/guide/access-tokens.md).
- [Security boundaries](docs/guide/security.md) and [troubleshooting](docs/guide/troubleshooting.md).
- [Documentation index](docs/README.md) and [API reference](docs/api-reference.md).

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Scope and design
contract: the [design documents](docs/design/) ([development plan](docs/design/DEVELOPMENT-PLAN.md),
[SPEC](docs/design/SPEC-masquerade.md), [PRD](docs/design/PRD-masquerade.md)). Agents integrating
Masquerade into an application: [integration notes for agents](docs/guide/agents.md).
