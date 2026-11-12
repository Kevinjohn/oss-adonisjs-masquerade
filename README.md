# Masquerade for AdonisJS

[![checks](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/oss-adonisjs-masquerade/actions/workflows/checks.yml)
[![Node.js 24+](https://img.shields.io/badge/node-%3E%3D24-339933)](package.json)
[![AdonisJS 7](https://img.shields.io/badge/AdonisJS-7-5a45ff)](https://adonisjs.com)

> Pre-release. Installed from GitHub releases; not on npm.

## What you get

Masquerade lets an authorized operator use the application as another account for a fixed time
while staying signed in as themselves. It never logs in as the target or creates a target
credential.

- Your `canMasquerade` policy approves each operator and target.
- Access is read-only by default; edit access requires an explicit policy approval.
- Sensitive routes stay blocked while a mode is active.
- The mode expires automatically and can be stopped explicitly.
- Native AdonisJS sessions and opaque access tokens are supported.

## Install

Masquerade requires Node.js 24+ and AdonisJS 7. Install the scoped `0.2.8` release from GitHub:

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-masquerade/releases/download/v0.2.8/kevinjohn-adonisjs-masquerade-0.2.8.tgz
node ace configure @kevinjohn/adonisjs-masquerade --namespace=my_app --guard=web
```

The release asset is `kevinjohn-adonisjs-masquerade-0.2.8.tgz`; verify it against the SHA-256 in
the [release notes](https://github.com/Kevinjohn/oss-adonisjs-masquerade/releases/tag/v0.2.8). See the
[setup guide](docs/guide/setup.md) for peer dependencies and generated files.

## Quick example

Use the effective guard for customer-facing routes. Mark routes that allow edits or must remain
blocked during masquerade:

```ts
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { allowMutation, sensitive } from '@kevinjohn/adonisjs-masquerade/http'

const asCustomer = middleware.auth({ guards: ['web_effective'] })

router.get('/orders', [OrdersController, 'index']).use(asCustomer)
router.post('/orders/:id/notes', [OrdersController, 'note']).use(allowMutation()).use(asCustomer)
router.post('/account/password', [AccountController, 'update']).use(sensitive()).use(asCustomer)
```

## Tested against

|                         | Every pull request | Weekly and before each release          |
| ----------------------- | ------------------ | --------------------------------------- |
| Node.js                 | 24                 | 24                                      |
| AdonisJS core           | locked version     | lowest supported (7.0.0) and latest 7.x |
| Lucid                   | locked version     | lowest supported and latest 22.x        |
| SQLite (better-sqlite3) | yes                | yes                                     |
| PostgreSQL 16           | yes                | yes                                     |

## Documentation

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

## License

[MIT](LICENSE.md)

## User story catalogue

See the [source-reviewed user story catalogue](user-stories/README.md) for capability coverage and code-backed action flows.
