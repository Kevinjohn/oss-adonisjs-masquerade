# Contributing

Thanks for helping. Bug reports and documentation fixes are welcome.

## Before you start

- For a bug, open an issue with a reproduction first, unless the fix is one line.
- For a feature or behavior change, open an issue to agree on the shape before writing code.
- Report security problems privately as described in [SECURITY.md](SECURITY.md). Do not open a
  public issue.

## Project principles

Every change follows these principles.

- **Built for everyone who uses AdonisJS.** Follow the open-source AdonisJS packages and starter
  kits for names, shapes and behavior. Match AdonisJS Plus only where that costs nothing; Plus
  compatibility is not a goal and never outweighs consistency for open-source users.
- **The application owns its language.** Errors carry stable codes and English fallback messages.
  If the request context has `i18n`, Masquerade looks up `errors.<code>` there; the package ships no
  translations, loader or locale setting.
- **The actor stays authenticated.** Masquerade never logs in as the target, mints a target
  credential or combines actor and target permissions. See the
  [technical contract](docs/maintainers/design/spec-masquerade.md) for the invariants.

## Local setup

You need Node.js 24 and pnpm. The repository pins Node 24 in `.nvmrc`; `better-sqlite3` is compiled
for it and the tests fail under another Node version.

```sh
nvm use
pnpm install
pnpm quick:test
```

## Checks

Run the repository scripts, not bare tools. They carry the flags used by the release gate.

| Command                   | What it does                                               |
| ------------------------- | ---------------------------------------------------------- |
| `pnpm format:check`       | Checks tracked files with Prettier without writing changes |
| `pnpm lint`               | Runs ESLint                                                |
| `pnpm typecheck`          | Type-checks without emitting files                         |
| `pnpm quick:test`         | Runs the Japa suite against SQLite                         |
| `pnpm test`               | Runs the SQLite suite with coverage thresholds             |
| `pnpm test:pg`            | Runs the suite against local PostgreSQL 16                 |
| `pnpm build`              | Compiles the package to `build/`                           |
| `pnpm test:built-exports` | Checks package exports from the compiled output            |
| `pnpm test:consumer`      | Installs the packed package in a consumer application      |
| `pnpm docs:build`         | Builds the documentation site and checks links             |

`pnpm test:pg` needs PostgreSQL 16. To use your own server, set `DB_CLIENT=pg`, `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_DATABASE`, then run `pnpm quick:test`.

Changes to the control store or migrations should pass on both SQLite and PostgreSQL. The `checks`
workflow runs both for every pull request.

The _Tested against_ table in `README.md` mirrors `.github/workflows/checks.yml` and
`compat.yml`; change them in the same PR.

## Code layout

- `src/` holds the core service, policy, context token, errors and internal integration wiring.
- `auth/`, `http/`, and `native/` hold the effective guard, controllers and native authority.
- `stores/`, `testing/`, and `plugins/` hold the optional Lucid store, test support and API client.
- `providers/`, `commands/`, and `stubs/` hold the provider, Ace commands and configure templates.
- `tests/` mirrors the source. Shared fixtures live in `tests/helpers/`.

See the [maintainer source map](docs/maintainers/README.md) for module ownership and focused tests.
[AGENTS.md](AGENTS.md) describes the file responsibility and folder rules.

## Planning files

The accepted product and technical contracts live in
[`docs/maintainers/design/`](docs/maintainers/design/). Private working plans belong in the local,
gitignored `plans/` directory; do not commit them.

## Pull requests

- Keep each pull request focused on one change.
- Add or update tests. A bug fix should include a test that fails without the fix.
- Document user-facing changes and add a line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- Keep public error codes stable; changing one requires a breaking changelog entry.
- Write imperative commit messages that describe the change.

## Repository-specific

### Store adapters

A control store for another database is a useful first contribution. The conformance suite in
`@kevinjohn/adonisjs-masquerade/testing` checks a store against the behavior of the Lucid store, including
compare-and-swap behavior with concurrent connections.

## Code of conduct

Everyone taking part in this project follows the [code of conduct](CODE_OF_CONDUCT.md).
