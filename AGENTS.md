# Agent instructions

## Node version

- Use Node 24 for every command in this repository. `package.json` requires `node >=24`.
- `.nvmrc` pins `24`. If the shell starts on another version, run `nvm use` (or put
  `~/.nvm/versions/node/v24.*/bin` first on `PATH`) before `pnpm` commands.

## Project principles

The same rules as `CONTRIBUTING.md`; every change follows them.

- **Built for everyone who uses AdonisJS.** Follow the open-source AdonisJS packages and starter
  kits for names, shapes and behaviour. Match AdonisJS Plus only where that costs nothing; Plus
  compatibility is not a goal and never outweighs consistency for open-source users.
- **The application owns its language.** Errors carry stable codes and English messages. The host
  exception handler localises; the package ships no translations, loader or locale setting.
- **The design documents are the contract.** `docs/design/DEVELOPMENT-PLAN.md` is the accepted
  v1 scope, `docs/design/SPEC-masquerade.md` the technical contract and
  `docs/design/PRD-masquerade.md` the product boundaries. A change that moves a settled boundary goes back to the owner, not into code.

## Checks

- `pnpm check` runs the quick profile (`--full`, `--browser` add the rest; see `CONTRIBUTING.md`).
- Run the repository scripts, not the bare tools: `pnpm lint`, `pnpm typecheck`, `pnpm build`,
  `pnpm quick:test` (SQLite), `pnpm test:built-exports` and `pnpm test:pg` (local PostgreSQL 16
  required; see docs/maintainers/conventions.md for the external-server alternative).

## Single Responsibility Principle (files)

Each file does one thing and is named for it. This keeps the codebase easy to hold in your head,
even if it means more files.

1. One coherent responsibility per file. Independent reasons to change are a prompt to look for
   separate files; related operations such as encoding/decoding or schema creation/teardown can
   belong together.
2. Name the file for the responsibility. A reader should guess what `src/context_token.ts` does
   without opening it.
3. Split at a seam, not at a line count. A seam is a group of functions that share data or a
   purpose and that the rest of the file only calls. A file that just forwards calls is not a
   seam; leave it in place.
4. Size can prompt investigation but never mandates a split. Investigate when a task requires
   reading substantial unrelated context or an internal cluster has a smaller, useful interface.
   State the proposed seam, reading benefit, added dependencies and regression risk. A second
   caller is evidence of value, not a prerequisite. Keep ordered orchestration and atomic
   operations together; explain a large file's cohesion when it is not obvious.
5. Keep the entry point. The original file re-exports what its importers use, so nothing outside
   the directory changes.
6. Move, do not edit. A split commit only moves code. Run the repository scripts before any
   further change.
7. Tests follow the source. One spec per module or closely related pair. Shared fixtures go in
   `tests/helpers/` once. Do not rename tests while moving them.
8. Small and cohesive is finished. Do not split a file that already does one thing. A small file
   can still contain independent responsibilities worth separating.
