# Contributing

Thanks for helping. Bug reports, documentation fixes and store adapters are all welcome.

## Before you start

- For a bug, open an issue with a reproduction first, unless the fix is a one-line change.
- For a new feature or a behaviour change, open an issue to agree the shape before writing code.
  Masquerade keeps a small public surface on purpose, and the
  [development plan](docs/design/DEVELOPMENT-PLAN.md) records what v1 deliberately leaves out.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md). Do not open a
  public issue.

## Project principles

Every change follows these.

- **Built for everyone who uses AdonisJS.** Follow the open-source AdonisJS packages and starter
  kits for names, shapes and behaviour. Match AdonisJS Plus only where that costs nothing; Plus
  compatibility is not a goal and never outweighs consistency for open-source users.
- **The application owns its language.** Errors carry stable codes and English messages. The host
  exception handler localises; the package ships no translations, loader or locale setting.
- **The actor stays authenticated.** Masquerade never logs in as the target, mints a target
  credential or unions actor and target permissions. Section 3 of
  [SPEC-masquerade.md](docs/design/SPEC-masquerade.md) lists the invariants; a pull request that weakens one is a product change, not a fix.

## Local setup

You need Node.js 24 and pnpm. The repository pins Node 24 in `.nvmrc`; `better-sqlite3` is compiled
against it and the tests fail under other versions.

```sh
nvm use
pnpm install
pnpm quick:test
```

To skip local setup, open the repository in GitHub Codespaces. The dev container installs Node 24,
pnpm and the dependencies; run `pnpm quick:test` once it is ready.

## Checks

Run the repository scripts, not the bare tools. They carry the flags the release gate uses.
`pnpm check` runs them in order and stops at the first failure:

| Command                | What it adds                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm check`           | Lint, typecheck, the SQLite test suite, build and the built-export test                                          |
| `pnpm check --full`    | PostgreSQL suite, coverage, recipe, demo launcher, docs build, packed consumer and Account Kit consumer (SQLite) |
| `pnpm check --browser` | Account Kit demo, native-session browser suite, Inertia React and Vue examples                                   |

Run `pnpm check` before every pull request, and add `--full` for changes to the store, the
packaging or the docs. `--browser` needs the native-session example's dependencies and Chromium
(`pnpm install` and `pnpm dlx playwright install chromium` in `examples/native-session`). The flags combine. Every pull request runs the `checks`
workflow: lint, typecheck, build, the built-export test and coverage on SQLite and PostgreSQL. The `e2e`
workflow runs the demo launcher, recipe and browser checks on pull requests that change `examples/`,
`http/`, `stubs/` or `docs/guide/`; `docs` builds the site when `docs/` changes. `e2e` and
`account-kit` also run nightly, and both run with `consumer` before every release; `account-kit` and
`consumer` cover PostgreSQL as well. `bin/check_profiles.ts`
lists the steps, and a test fails if CI runs a script that no profile covers.

`pnpm test:pg` needs PostgreSQL 16 binaries (`brew install postgresql@16` on macOS). To use your
own server instead, set `DB_CLIENT=pg` plus `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and
`DB_DATABASE`, then run `pnpm quick:test`.

`pnpm test:mutation` runs Stryker against `src/` with `pnpm quick:test`. It edits the source files
in place while it runs and restores them afterwards, so run it on a clean checkout. The `mutation`
workflow runs it weekly and on demand and uploads the report; it fails when the score drops below
the `break` threshold in `stryker.config.json`. `pnpm test` and `pnpm test:coverage` fail when line
or branch coverage drops below the thresholds in the `c8` block of `package.json`.

Changes to the control store or its migrations should pass on both SQLite and PostgreSQL. The
`checks` workflow runs both on every pull request.

## Code layout

The layout follows [SPEC-masquerade.md](docs/design/SPEC-masquerade.md) section 2.

- `src/` holds the core: state machine, policy, context token, expiry, errors. One responsibility
  per file.
- `auth/` holds the effective guard, `http/` the controllers, middleware and markers, `native/`
  the native session authority.
- `stores/` holds the optional Lucid control store, `providers/` the AdonisJS provider and
  `testing/` the memory store and conformance suite.
- `tests/` mirrors the source: one spec per module. Shared fixtures live in `tests/helpers/`.

[The maintainer source map](docs/maintainers/source-map.md) maps common tasks to their owning
modules, contracts and focused tests. Start there before loading the implementation history.

[AGENTS.md](AGENTS.md#single-responsibility-principle-files) describes the responsibility and file-splitting rules the codebase follows.
[docs/maintainers/conventions.md](docs/maintainers/conventions.md) records where every convention
comes from.

## Pull requests

- Keep each pull request to one change.
- Add or update tests. A bug fix should include a test that fails without the fix.
- Update the relevant page in `docs/` and add a line under `## Unreleased` in
  [CHANGELOG.md](CHANGELOG.md) when behaviour visible to users changes.
- Write commit messages in the imperative mood, describing the change ("Reject a stale stop
  against a newer mode").

## Store adapters

A control store for another database is a good first contribution. The conformance suite in
`adonisjs-masquerade/testing` checks a store against the same behaviour the Lucid store passes,
including compare-and-swap under concurrent connections.

## Code of conduct

Everyone taking part in this project follows the [code of conduct](CODE_OF_CONDUCT.md).
