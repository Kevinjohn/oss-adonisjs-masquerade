# Agent instructions

## Node version

- Use Node 24 (`.nvmrc`) for every command. CI tests Node 24 only. `better-sqlite3` is compiled
  against Node 24; under another version the test suite fails with `NODE_MODULE_VERSION` errors.

## Project principles

The same rules as `CONTRIBUTING.md`; every change follows them.

- **Built for everyone who uses AdonisJS.** Follow the open-source AdonisJS packages and starter
  kits for names, shapes and behavior. Match AdonisJS Plus only where that costs nothing; Plus
  compatibility is not a goal and never outweighs consistency for open-source users.
- **The application owns its language.** Errors carry stable codes and English fallback messages.
  If the request context has `i18n`, Masquerade looks up `errors.<code>` there; the package ships no
  translations, loader or locale setting.

## Checks

- `pnpm check` runs formatting, lint, types, SQLite tests, build and built exports.
- `pnpm check --full` appends PostgreSQL, coverage, the SQLite recipe, docs build, fixture pack,
  SQLite consumer and the full SQLite Account Kit integration profile.
- `pnpm check --browser` appends the Account Kit demo, native-session, React and Vue browser
  gates to quick. Combine `--full --browser` to select both additions; neither implies the other.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm lint` — `eslint .`.
- `pnpm format` — `prettier --write .`.
- `pnpm format:check` — checks tracked files with Prettier.
- `pnpm quick:test` — Japa tests against SQLite.
- `pnpm pretest` — runs `pnpm lint` before tests.
- `pnpm test` — runs `pnpm quick:test` under c8 coverage.
- `pnpm test:built-exports` — tests the built package exports.
- `pnpm test:consumer` — installs the packed package in a consumer app.
- `pnpm test:pg` — runs tests against local PostgreSQL 16.
- `pnpm pg:start` — starts the local PostgreSQL test service.
- `pnpm pg:stop` — stops the local PostgreSQL test service.
- `pnpm check:changed` — runs checks selected for changed files.
- `pnpm precompile` — runs `pnpm lint` before compilation.
- `pnpm compile` — compiles the package and emits declarations.
- `pnpm postcompile` — copies configure templates into the build output.
- `pnpm build` — runs `pnpm compile`.
- `pnpm docs:api` — generates the API reference.
- `pnpm docs:dev` — generates the API reference and serves the documentation site.
- `pnpm docs:build` — generates the API reference and builds the documentation site.

## Single Responsibility Principle (files)

Each file does one thing and is named for it. This keeps the codebase easy to hold in your head,
even if it means more files.

1. One responsibility per file. If you need "and" to describe it, it is two files.
2. Name the file for the responsibility. A reader should guess what
   `src/context_token.ts` does without opening it.
3. Split at a seam, not at a line count. A seam is a group of functions that share data or a
   purpose and that the rest of the file only calls. A file that just forwards calls is not a
   seam; leave it in place.
4. Size is a prompt, not a rule. At about 800 lines, look for a seam. At about 1,500, split in the
   next change that touches the file. A file kept large on purpose (a data table, generated code,
   one long table-driven test) says why in a short comment at the top.
5. Keep the entry point. The original file re-exports what its importers use, so nothing outside
   the directory changes.
6. Move, do not edit. A split commit only moves code. Run the repository scripts before any
   further change.
7. Tests follow the source. One spec per module or closely related pair. Shared fixtures go in
   `tests/helpers/` once. Do not rename tests while moving them.
8. Small and cohesive is finished. Do not split a file that is under the first threshold and does
   one thing.

## Folder layout

```text
index.ts                    public entry
configure.ts                `node ace configure` hook
providers/<name>_provider.ts
commands/                   Ace commands, where they exist
services/main.ts            container service, where it exists
stubs/                      configure templates, where they exist
src/                        implementation; src/types.ts and src/errors.ts for public types and errors
<subpath>/main.ts           top-level folder only when it backs a package.json export
bin/                        package scripts (.ts via ts-exec; .sh allowed)
bin/helpers/                modules used only by bin/
tests/                      flat Japa specs
tests/helpers/              shared test helpers
tests/fixtures/             static fixtures, where they exist
tests/tooling/              specs for bin/
tests/types/                type-level tests (.ts, not .spec.ts), checked by `pnpm typecheck`
examples/                   example apps
docs/                       user and maintainer documentation
```

1. A top-level folder exists only for an exported subpath. It holds that subpath's entry and the
   modules only that subpath uses; anything shared with other subpaths goes in `src/`.
2. Scripts are TypeScript files under `bin/`, run with `node --import=@poppinss/ts-exec`.
3. All tests run under one Japa config with `files: ['tests/**/*.spec.ts']` and no suites.
4. Do not add a `scripts/` folder.

## Repository-specific

Masquerade has not had an independent security review. Security-sensitive changes must preserve the
threat boundaries in [the security guide](docs/guide/security.md) and [the technical contract](docs/maintainers/design/spec-masquerade.md).
