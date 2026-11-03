# Verification

Use Node 24 and the pnpm version pinned in `package.json`. Run the repository scripts so the
same flags apply locally and in CI:

```sh
pnpm check
pnpm check --full
```

The quick profile checks formatting, lint, types, SQLite tests, the build, and built exports.
The full profile adds PostgreSQL 16, coverage, the documented recipe, the docs
build, and packed native-session and Account Kit consumers. `bin/check_profiles.ts` defines the
steps. `pnpm check:changed [base]` selects checks while working; it does not replace the full gate.

`pnpm test:pg` starts a disposable PostgreSQL 16 cluster. It uses Homebrew `postgresql@16`, the
Debian or Ubuntu `postgresql-16` package in `/usr/lib/postgresql/16/bin` (from
[apt.postgresql.org](https://wiki.postgresql.org/wiki/Apt) where the distribution ships a newer
major version), or `pg_ctl` on `PATH`; set `PG_BIN` to use another bin directory. Set `DB_PORT`
to an unused port when another local cluster is running. For an existing server, set `DB_CLIENT=pg`, `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_DATABASE`, then run `pnpm quick:test`.

Prepare the native-session example before running the browser profile:

```sh
pnpm build
pnpm pack:fixture
pnpm --dir examples/native-session install --no-frozen-lockfile
pnpm dlx playwright@1.60.0 install chromium
pnpm check --browser
```

The browser profile exercises the Account Kit demo, native-session browser suite, and Inertia
React and Vue examples. Run shared application and database fixtures serially; separate checkouts
do not isolate their fixed ports. `pnpm --dir examples/native-session test:ui` runs the isolated
client-state tests under Japa.

For documentation changes, `pnpm docs:build` checks the VitePress site and generated API pages.
The documentation specs verify exact tracked Markdown paths, heading anchors, navigation, and
links in packed Markdown. The release workflow calls `checks`, `compat`, and `examples` before its local
[tag, changelog, build, and tarball gate](releasing.md). The docs build remains a separate gate.
