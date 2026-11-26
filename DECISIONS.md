# Decisions

## Departures

1. **Aligning** — PKG-7. First-party `@kevinjohn/*` peers are pinned to the exact supported release until launch, because the packages depend on one specific Account Kit version. Third-party peers use caret ranges. Brought into line by #495.

2. **Aligning (#502)** — PKG-1. Keep the exported-subpath folders required by this repository's folder-layout contract (`account_kit/`, `auth/`, `http/`, `masquerade_context_middleware/`, `native/`, `plugins/`, `stores/`, `testing/`). Documentation tooling and application overlays also remain in `docs/` and `examples/`; they are not shipped package implementation. Resolve the layout and analysis constraints in #502 before removing these folders; the owning analysis work is [package entry points and documentation tooling](https://github.com/Kevinjohn/oss-adonisjs-code-conventions/issues/25).

3. **Aligning (#502)** — IMP-5. Application overlays without their own manifest inherit the native-session application's aliases, and tooling tests contain source strings that generate application imports. The checker currently treats both as package imports. Preserve those aliases and generated JavaScript imports until the analysis work tracked by #502 distinguishes application source and source strings from package imports. The owning work is [source-string analysis](https://github.com/Kevinjohn/oss-adonisjs-code-conventions/issues/24). Actual package imports still use relative `.ts` paths.

4. **Aligning (#502)** — NAM-1. The `examples/account-kit` overlay folder is referenced by a compatibility workflow path filter. Rename that folder and its filter together in #502; this batch does not modify CI configuration. The separate demo overlay can use `account_kit_demo` without changing CI configuration.

5. DB-6. Migrations that delegate to `createMasqueradeSchemaV1` create the package's related control and event tables together. The helper owns both table names, so the host migration has no singular `tableName` to use. Other migrations declare their actual table name.
