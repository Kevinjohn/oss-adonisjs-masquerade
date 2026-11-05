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

The Account Kit and consumer latest profiles query versions already filtered by each peer range.
Their shared selector accepts canonical stable `x.y.z` versions and compares numeric components;
prereleases, build metadata, malformed values, and unsafe or leading-zero components are
rejected. Supporting another version form requires an appropriate version parser.

`pnpm test:pg` starts a disposable PostgreSQL 16 cluster. Set `DB_PORT` to an unused port when
another local cluster is running. For an existing server, set `DB_CLIENT=pg`, `DB_HOST`,
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

## Consumer process cleanup

The packed consumer harness applies a 10-minute timeout to each command. On timeout or the
first SIGINT/SIGTERM, it sends TERM to the command's owned process group, waits up to five
seconds, sends KILL if the group remains, and waits up to five more seconds for reap. A second
signal escalates the active owned group; the first interrupt determines exit status 130 or 143.
Normal completion also cleans any remaining owned descendants before later work starts.

Interrupted ordinary work does not continue. This run's per-schema drop and locally owned
PostgreSQL stop remain allowed cleanup. With `CONSUMER_PG_EXTERNAL=1`, the harness leaves the
externally provided service running. Cleanup and evidence-write failures remain failures;
a final reap failure reports partial output and releases local handles without claiming the
process was reaped.

## Changelog link policy

The default relative-path and heading checks in `tests/docs_links.spec.ts` exclude
`CHANGELOG.md`, because historical relative destinations can age out. The separate check of
GitHub links into this repository's `main` tree still includes the changelog. These checks do
not fetch external URLs.

Preserve dated release prose and external artifact URLs. Review changed current-relative
changelog links against their actual destinations and headings; correct a proven broken link,
or use an immutable historical source when its artifact was intentionally removed. Run
`pnpm quick:test --files=docs_links.spec.ts` for the applicable checked links, without claiming
it validates the excluded relative changelog links.

## Dependency advisory assessment

Assessment date: 2026-11-05. This section records the current main snapshot and separately records
open candidate pull requests. It covers the Masquerade root graph, its M E4 React example, M E5
Vue example, and M E6 native-session example. Other repositories and example graphs are outside
this assessment.

The main baseline is `f32bd4ed3f886da9e3c9b0dda8f2eb7769722fb2`. Audit snapshots used Node
24.22.2 through the Node 24 runtime guard and pnpm 11.23.0. Candidate audit snapshots are tied to
the exact heads below; none of these candidate changes is described as merged into main.

| Graph             | Main baseline  | Open candidate snapshot                                                                                                   | Audit occurrences |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------: |
| M root            | `f32bd4e` — 16 | [PR #282](https://github.com/Kevinjohn/oss-adonisjs-masquerade/pull/282), `f8c4bdfc5f0f81a62b6663b17895a9069f28b0de` — 12 |           16 → 12 |
| E4 React          | `f32bd4e` — 3  | [PR #285](https://github.com/Kevinjohn/oss-adonisjs-masquerade/pull/285), `5434fe843d307a2dde5eaafd3f4ab47de86c13bf` — 2  |             3 → 2 |
| E5 Vue            | `f32bd4e` — 2  | no candidate; unchanged main snapshot — 2                                                                                 |             2 → 2 |
| E6 native-session | `f32bd4e` — 18 | [PR #286](https://github.com/Kevinjohn/oss-adonisjs-masquerade/pull/286), `5583035407d024079b2f56e06578038ca53be678` — 2  |            18 → 2 |

Across these four graphs, main has 39 advisory occurrences for 28 distinct GHSA IDs. The three
candidate snapshots plus unchanged E5 have 18 occurrences for 12 distinct IDs. IDs can occur in
more than one graph: an example candidate that no longer reports an ID does not close the same ID
on the root graph. In particular, five Vite IDs removed from E6 remain on the root Vite 5 path.
These counts describe audit snapshots; they do not establish merged or fully verified fixes.

### Per-graph disposition

Each row below is one baseline GHSA occurrence in one graph. Parent paths are abbreviated after the
first relevant package chain; repeated transitive paths are noted where the audit emitted many
framework peer paths. The audit finding records the complete path set.

#### M root

| Baseline GHSA                                                            | Baseline package and parent path                                                                                               | Snapshot disposition                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | `esbuild@0.21.5`, `vitepress > vite > esbuild` and `vitepress > @vitejs/plugin-vue > vite > esbuild`                           | Deferred with the stable VitePress toolchain.                                                                                             |
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) | `vite@5.4.21`, `vitepress > vite` and `vitepress > @vitejs/plugin-vue > vite`                                                  | Deferred on the root docs-build path.                                                                                                     |
| [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) | `qs@6.15.1`, `superagent > qs` through `@japa/api-client` under Auth, Session, and Account Kit                                 | Addressed in open PR #282's candidate at `qs@6.16.1`; root candidate audit no longer reports it.                                          |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | `vite@5.4.21`, `vitepress > vite` and `vitepress > @vitejs/plugin-vue > vite`                                                  | Deferred; this is the Vite 5 docs-tool path.                                                                                              |
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) | `qs@6.15.1`, `superagent > qs` through `@japa/api-client` under Auth, Session, and Account Kit                                 | Addressed in open PR #282's candidate at `qs@6.16.1`; root candidate audit no longer reports it.                                          |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | `qs@6.15.1`, `superagent > qs` through `@japa/api-client` under Auth, Session, and Account Kit                                 | Addressed in open PR #282's candidate at `qs@6.16.1`; root candidate audit no longer reports it.                                          |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | `vite@5.4.21`, `vitepress > vite` and `vitepress > @vitejs/plugin-vue > vite`                                                  | Deferred on the root Vite 5 path; E6's Vite 8 candidate does not change this occurrence.                                                  |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | `vite@5.4.21`, `vitepress > vite` and `vitepress > @vitejs/plugin-vue > vite`                                                  | Deferred on the root Vite 5 path; E6's Vite 8 candidate does not change this occurrence.                                                  |
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | `vite@5.4.21`, `vitepress > vite` and `vitepress > @vitejs/plugin-vue > vite`                                                  | Deferred on the root Vite 5 path; E6's Vite 8 candidate does not change this occurrence.                                                  |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | `vite@5.4.21`, `vitepress > vite` and `vitepress > @vitejs/plugin-vue > vite`                                                  | Deferred on the root Vite 5 path; E6's Vite 8 candidate does not change this occurrence.                                                  |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | `vite@5.4.21`, `vitepress > vite` and `vitepress > @vitejs/plugin-vue > vite`                                                  | Deferred on the root Vite 5 path; E6's Vite 8 candidate does not change this occurrence.                                                  |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | `vite@5.4.21`, `vitepress > vite` and `vitepress > @vitejs/plugin-vue > vite`                                                  | Deferred on the root Vite 5 path.                                                                                                         |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | `deepmerge@4.3.1`, through `@adonisjs/lucid` directly and through Auth, Session, and Account Kit parents                       | Retained. Lucid is an actual dependency path; the safe handling of attacker-controlled merge inputs depends on the consuming application. |
| [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) | `qs@6.15.1`, `superagent > qs` through `@japa/api-client` under Auth, Session, and Account Kit                                 | Addressed in open PR #282's candidate at `qs@6.16.1`; root candidate audit no longer reports it.                                          |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | `glob@13.0.6`, `c8 > test-exclude > glob`                                                                                      | Retained on the coverage-tool path; a supported parent update remains future work.                                                        |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `minimatch@10.2.6`, `@adonisjs/assembler > ts-morph > @ts-morph/common > minimatch`; 100 audit paths through framework parents | Retained; no forced minimatch major override is selected.                                                                                 |

The root's nine deferred docs-tool occurrences are the eight Vite 5 findings and esbuild finding
listed above. Their applicability depends on use and exposure of the development/docs server,
platform-specific path handling, or editor integration described by each advisory. They are not
closed by calling the dependency a development tool.

#### E4 React

| Baseline GHSA                                                            | Baseline package and parent path                                                                 | Snapshot disposition                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | `deepmerge@4.3.1`, through Lucid under Auth, Session, Inertia, and related adapter paths         | Retained on the Lucid path; input reachability is application-specific.                                                                                                                                                                                     |
| [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p) | `follow-redirects@1.16.1`, through `axios@1.20.0` under Inertia React and `laravel-precognition` | Addressed in open PR #285's candidate at `follow-redirects@1.16.2`; candidate audit no longer reports it. Axios 1.20.0 normalizes cross-realm `sensitiveHeaders`; the advisory did not reproduce in the recorded triage, and no credential leak is claimed. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `minimatch@10.2.6`, through `@ts-morph/common`; 100 audit paths through framework parents        | Retained.                                                                                                                                                                                                                                                   |

The candidate keeps the existing Inertia 4, React client 2, and Vite plugin 5 stack. The Inertia
major migration remains deferred and is separate from the targeted redirect dependency.

#### E5 Vue

| Baseline GHSA                                                            | Baseline package and parent path                                                          | Snapshot disposition                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | `deepmerge@4.3.1`, through Lucid under Auth, Session, Inertia, and related adapter paths  | Retained; no E5 dependency candidate was selected. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `minimatch@10.2.6`, through `@ts-morph/common`; 100 audit paths through framework parents | Retained; no E5 dependency candidate was selected. |

#### E6 native-session

Open PR #286's candidate audit removes these 16 baseline occurrences. The lock snapshot resolves
Vite 8.3.3, browserslist 4.28.7, `@faker-js/faker` 10.5.0, baseline-browser-mapping 2.11.0,
brace-expansion 5.0.12, source-map-js 1.2.2, proxy-addr 2.0.8, and fast-copy 4.1.0. These are
candidate outcomes, not main-branch changes.

| Baseline GHSA                                                            | Baseline package and parent path                                                                         | Snapshot disposition                                                                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | `browserslist@4.28.2`, `@adonisjs/eslint-config > eslint-plugin-unicorn > core-js-compat > browserslist` | Removed from the open E6 candidate audit at browserslist 4.28.7.                                                                                                      |
| [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | `browserslist@4.28.2`, same ESLint-config path                                                           | Removed from the open E6 candidate audit at browserslist 4.28.7.                                                                                                      |
| [GHSA-qxc2-j82w-r537](https://github.com/advisories/GHSA-qxc2-j82w-r537) | `@faker-js/faker@10.4.0`, through Lucid under Auth, Session, and Limiter (11 paths)                      | Removed from the open E6 candidate audit at 10.5.0.                                                                                                                   |
| [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) | `baseline-browser-mapping@2.10.32`, below the browserslist/core-js-compat chain                          | Removed from the open E6 candidate audit at 2.11.0.                                                                                                                   |
| [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | `brace-expansion@5.0.9`, through `minimatch > @ts-morph/common` under Assembler (100 paths)              | Removed from the open E6 candidate audit at 5.0.12.                                                                                                                   |
| [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | `brace-expansion@5.0.9`, same minimatch path                                                             | Removed from the open E6 candidate audit at 5.0.12.                                                                                                                   |
| [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | `brace-expansion@5.0.9`, same minimatch path                                                             | Removed from the open E6 candidate audit at 5.0.12.                                                                                                                   |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | `source-map-js@1.2.1`, `vite > postcss > source-map-js` and `@adonisjs/vite > vite > postcss`            | Removed from the open E6 candidate audit at 1.2.2.                                                                                                                    |
| [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) | `proxy-addr@2.0.7`, through `@adonisjs/http-server` under Core/Auth and related parents (100 paths)      | Removed from the open E6 candidate audit at 2.0.8. The advisory concerns trust handling for IPv4-mapped IPv6 subnets; it does not describe every request as affected. |
| [GHSA-jggr-w7fw-pc2j](https://github.com/advisories/GHSA-jggr-w7fw-pc2j) | `fast-copy@4.0.3`, through `pino-pretty` under logger parents (100 paths)                                | Removed from the open E6 candidate audit at 4.1.0; the candidate reaches this floor without a pino-pretty upgrade.                                                    |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | `vite@8.3.0`, direct Vite and `@adonisjs/vite > vite`                                                    | Removed from the open E6 candidate audit at Vite 8.3.3; this same ID remains deferred on the M root Vite 5 path.                                                      |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | `vite@8.3.0`, direct Vite and `@adonisjs/vite > vite`                                                    | Removed from the open E6 candidate audit at Vite 8.3.3; this same ID remains deferred on the M root Vite 5 path.                                                      |
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | `vite@8.3.0`, direct Vite and `@adonisjs/vite > vite`                                                    | Removed from the open E6 candidate audit at Vite 8.3.3; this same ID remains deferred on the M root Vite 5 path.                                                      |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | `vite@8.3.0`, direct Vite and `@adonisjs/vite > vite`                                                    | Removed from the open E6 candidate audit at Vite 8.3.3; this same ID remains deferred on the M root Vite 5 path.                                                      |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | `vite@8.3.0`, direct Vite and `@adonisjs/vite > vite`                                                    | Removed from the open E6 candidate audit at Vite 8.3.3; this same ID remains deferred on the M root Vite 5 path.                                                      |
| [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg) | `vite@8.3.0`, direct Vite and `@adonisjs/vite > vite`                                                    | Removed from the open E6 candidate audit at Vite 8.3.3.                                                                                                               |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | `deepmerge@4.3.1`, through Lucid under Auth, Session, Limiter, and other framework parents (11 paths)    | Retained. Lucid remains a real dependency path; no safe deepmerge replacement or compatible parent release was established in this assessment.                        |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `minimatch@10.2.5`, through `@adonisjs/assembler > ts-morph > @ts-morph/common`; 100 framework paths     | Retained at the same version in the E6 candidate.                                                                                                                     |

The candidate uses a local Masquerade archive whose stale optional Account Kit peer metadata was
aligned from 0.1.5 to 0.2.0, matching the existing root manifest. The peer remains optional, no
external Account Kit version was added or moved, and no public peer requirement changed. This is
local archive metadata alignment, not an Account Kit dependency upgrade.

Candidate E6 lint, typecheck, build, and 68 functional tests passed. The local browser diagnostic
used Playwright 1.60.0 / Chromium revision 1223 on Ubuntu 26.04 ARM64 with the package's
Ubuntu 24.04 ARM64 platform override: 7 tests passed and one assertion failed at
`tests/browser/support_workspace.spec.ts:69` (expected customer select ID `2`, received an empty
value). The failure cause remains unresolved. The unmodified local browser install rejected the
Ubuntu 26.04 host. The supported Ubuntu 24.04 hosted browser job is pending; no final browser pass is claimed here.

### Applicability and audit limits

- `qs` findings concern specific comma-format parsing/stringifying inputs in the reported
  `superagent@10.4.1 > qs` chain (`superagent` accepts `qs` `^6.14.1`). The audit path establishes
  dependency presence, not that an application exposes the vulnerable call with attacker-controlled
  input.
- `follow-redirects` is reached through Axios redirect handling. The candidate patches the reported
  package; the recorded triage did not reproduce the cross-realm header scenario, so this assessment
  makes no demonstrated credential-leak claim.
- Vite/editor findings have different conditions, including development-server use, Windows path or
  editor behavior, and file-serving configuration. The root docs graph and E6 application graph are
  separate dependency paths.
- Other reported inputs are also conditional: browserslist memory growth needs many distinct
  queries; its stats-file issue needs untrusted `browserslist-stats.json`; baseline-browser-mapping
  is triggered by invalid input; brace-expansion findings need crafted nested patterns; source-map-js
  needs hostile indexed-map offsets; and fast-copy's stack exhaustion needs deeply nested values.
  Their audited parent paths alone do not show that a consumer passes such inputs to those packages.
- `proxy-addr` risk depends on proxy trust configuration and IPv4-mapped IPv6 subnet handling.
- `deepmerge`, `minimatch`, `glob`, and tooling-path findings remain reported. Their presence in
  tooling graphs does not establish that an application is unreachable, and audit output alone does
  not establish exploitability.
- A root production-only audit may report no installed production packages because this package
  consumes framework dependencies as peers. That result does not audit a consumer's resolved graph
  or establish consumer security clearance.

### Manual follow-up register

This register is reviewed manually at a future dependency assessment. It does not create issues,
subscriptions, or scheduled checks.

- **Lucid and deepmerge:** Recheck for a supported Lucid release that removes or patches the
  vulnerable deepmerge path. No patched deepmerge version or safe replacement was established here.
  Any candidate must preserve the supported Lucid API and verify the actual merge inputs; do not
  infer safety from fewer audit rows.
- **ESLint, TypeDoc, ts-morph, and coverage tooling:** Recheck supported parent releases for
  `minimatch` and `glob`. `minimatch` is reached through `ts-morph > @ts-morph/common`; `glob` is
  reached through `c8 > test-exclude`. Record parent constraints and validate lint, type, docs, and
  coverage consumers for any future resolution. Do not force a major override.
- **Stable VitePress toolchain:** Recheck for a supported compatible Vite/esbuild security path.
  A VitePress major migration or docs-install reorganization needs a separate decision and real
  docs-build verification.
- **Next review:** Revalidate registry advisories and parent metadata against the then-current
  manifests and lockfiles. This dated snapshot is not a continuing guarantee.
