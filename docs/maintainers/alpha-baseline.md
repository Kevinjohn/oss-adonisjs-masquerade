# Alpha baseline verification

## Candidate and tag state

- Validated source: `9fd2d232dd4a47220a86af27ba42d551a79886dd`, the clean `main` checkout used for this run.
- Candidate tag: `alpha-1` is unused and remains pending until this verification record and the corrected fresh-host recipe are merged. If it remains unused, create an annotated tag on the validated source commit above; do not move or replace an existing tag.
- Package manifest: `adonisjs-masquerade@0.0.0`. This is a local alpha baseline, not a registry version.
- Environment: macOS 26.6.2, arm64; Node `v24.21.0`; pnpm `11.23.0`.
- Root lockfile SHA-256: `ea06d0ba379989cd380bb5e2f5cb7ffa913965beb2361af8e6c8869f0bc6d63b`.
- Local artifact: `tmp/alpha-baselines/alpha-1/native-session-package.tgz` (ignored by Git), SHA-256 `24f51de777f1974cff8cfcdd86181f61a2178bfba96428d10ec1066fb2bf024d`.

The repository build used the locked direct toolchain, including AdonisJS Core `7.6.0`, Auth `10.1.0`, Lucid `22.4.2`, Session `8.3.0`, and TypeScript `5.9.3`. The preserved consumer runs resolved the compatibility matrix below from this same tarball.

## Package inspection

The tarball contains 111 files. Every declared runtime export resolves to a packaged file, and the configure entry point, declarations, and migration/configuration stubs are present. It contains no tests, examples, source checkout, `node_modules`, temporary files, docs tree, or spec files. The built-export test also passed against the artifact produced by this source revision.

## Checks

`pnpm check --full` passed on the candidate commit. This includes lint, typecheck, the SQLite suite (332 passed, 2 skipped), build, built exports (10 passed), PostgreSQL 16 suite (328 passed, 2 skipped), coverage, the SQLite recipe, demo launcher tests, docs build, packing, the floor/latest SQLite consumer profile, and the full SQLite Account Kit matrix.

The preserved artifact then passed the explicit consumer matrix:

| Profile | AdonisJS Core | Auth | Lucid | Session | TypeScript | SQLite | PostgreSQL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Floor | 7.0.0 | 10.0.0 | 22.4.2 | 8.1.0 | 5.9.3 | Pass | Pass |
| Latest resolved | 7.6.0 | 10.1.0 | 22.4.2 | 8.3.0 | 6.0.3 | Pass | Pass |

All four consumer cells passed 63 peer checks, with no incompatible peer warnings. Each PostgreSQL cell passed 59 functional tests, 1 token-only test, 2 report tests, and 1 credential test. Each SQLite cell passed 65 functional tests plus the same token-only, report, and credential counts. Commands used the preserved archive explicitly:

```sh
pnpm test:consumer --profile=all --database=sqlite --package=tmp/alpha-baselines/alpha-1/native-session-package.tgz
pnpm test:consumer --profile=all --database=pg --package=tmp/alpha-baselines/alpha-1/native-session-package.tgz
```

## Fresh AdonisJS host and browser journey

A clean host was copied from the official AdonisJS Hypermedia starter at `449d77cc25dd08e036f442d2d39b760d43ccfbd3`. It installed the preserved tarball from a local file, ran the public configure command, applied [the fresh-host wiring patch](adoption-validation/fresh-edge-host.patch), migrated a disposable SQLite database, and passed `pnpm typecheck`. Configure produced the raw `web` and effective `web_effective` guards. The host used fictional operator and customer accounts and Chromium on loopback port `3382`.

The browser workflow verified:

- the operator remained the authenticated actor while the customer was the effective identity;
- customer data could be read;
- the reversible preference changed Off → On → Off;
- the sensitive action was denied with HTTP 403;
- a form retained in another tab across stop/start was rejected with HTTP 409;
- the preference remained Off after the denied stale submission; and
- the raw operator session stopped the mode and returned to idle.

The fresh-host patch now explicitly requests edit access for the preference workflow and grants it only to an eligible customer when the actor is an authorized operator. It also leaves auth guard wiring to the package configure command, avoiding duplicate edits. The originally checked-in patch lacked that edit setup and attempted to repeat configure's auth wiring; the corrected patch was reapplied from a pristine starter, followed by migration and typecheck.

## Rebuild and limits

After `alpha-1` is available, select it and rebuild from a clean worktree as shown in the [setup guide](../guide/setup.md#generate-the-starter-files). Build and pack with Node 24 and pnpm, then compare the resulting tarball SHA-256 before reusing it. The manifest version remains `0.0.0`; no matching registry package exists.

This is local technical validation with fictional data. It does not establish production readiness, external-user usability, or validation by real application teams. No registry publication, GitHub Release, release asset upload, or release-workflow dispatch occurred. The release workflow is triggered only by manual dispatch.
