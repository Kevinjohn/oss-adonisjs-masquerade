# Decisions

## Departures

1. **Rule departure — PKG-7.** Owner policy: `@kevinjohn/*` dependencies and peers pin the exact first-party version they support and document it. The optional Account Kit peer supports exactly `0.8.0`, recorded in `package.json`, [the integration guide](docs/guide/account-kit.md) and `README-AGENTS.md`. Third-party peers retain caret ranges and their supported floors. This policy is permanent; #495's proposed removal of the pin is superseded.

2. **Aligning (#502)** — PKG-1 checker false positives. The checker requires this marker for Law exceptions; it records classification evidence with no pending implementation change or external dependency. Only `docs/` and `examples/` remain. The checker reports those two root paths because it sees documentation tooling under `docs/.vitepress/` and standalone applications or application overlays under `examples/`. Neither is shipped package implementation: the package publishes `build/`, and TypeScript's explicit package inputs exclude examples and documentation tooling. All implementation subpath entries are under `src/`; framework-owned folders remain at the root.

3. **Aligning (#502)** — IMP-5 checker false positives. The required marker records classification evidence with no pending implementation change or external dependency. The exact files below contain application overlay source or application source strings. The two overlays inherit the native-session application's `imports` map when their launchers copy and wire them into that host. The other seven files generate or compare source text; their actual package import nodes use relative `.ts` paths. No real package alias or JavaScript import is exempted. Every configuration link names one file that still produces a raw finding.

The exhaustive file list is in `conventions.config.json`, without directory-wide IMP-5 links:

- The 15 linked `examples/account_kit/` files are the integration overlay. [The integration runner](bin/test_account_kit.ts) copies them into the native-session host.
- The 20 linked `examples/account_kit_demo/` files are the browser-demo overlay. [Its preparation module](bin/helpers/prepare_account_kit_demo.ts) copies the native host, applies this overlay and wires its providers and middleware.
- Both overlays use the [native host’s imports map](examples/native-session/package.json). Their `#` imports are application imports. The seven remaining paths have the source-string evidence below; their actual local package imports use relative `.ts` paths.

| Exact source-string path                 | Evidence                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `bin/helpers/account_kit_host_wiring.ts` | Host-wiring replacements generate application auth, middleware and preload imports. |
| `bin/test_account_kit.ts`                | A generated application fixture imports its user model through the host alias.      |
| `bin/test_recipe.ts`                     | Template strings generate host models, routes and compiled JavaScript imports.      |
| `tests/account_kit_host_wiring.spec.ts`  | Expected generated kernel and auth source contains application aliases.             |
| `tests/configure.spec.ts`                | Fixture application kernel and route source contains host aliases.                  |
| `tests/configure_ace.spec.ts`            | Fixture application config and kernel source contains host aliases.                 |
| `tests/helpers/starter_kit.ts`           | Starter fixture files are written from application source strings.                  |
