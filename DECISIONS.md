# Decisions

## Departures

1. **Rule departure — PKG-7.** Owner policy: `@kevinjohn/*` dependencies and peers pin the exact first-party version they support and document it. The optional Account Kit peer supports exactly `0.8.0`, recorded in `package.json`, [the integration guide](docs/guide/account-kit.md) and `README-AGENTS.md`. Third-party peers retain caret ranges and their supported floors. This policy is permanent; #495's proposed removal of the pin is superseded.

2. **Aligning (#502)** — PKG-1 checker false positives. The checker requires this marker for Law exceptions; it records classification evidence with no pending implementation change or external dependency. Only `docs/` and `examples/` remain. The checker reports those two root paths because it sees documentation tooling under `docs/.vitepress/` and standalone applications or application overlays under `examples/`. Neither is shipped package implementation: the package publishes `build/`, and TypeScript's explicit package inputs exclude examples and documentation tooling. All implementation subpath entries are under `src/`; framework-owned folders remain at the root.

3. **Aligning (#502)** — IMP-5 checker false positives. The linked `examples/account_kit/` and `examples/account_kit_demo/` files are application overlays: their launchers copy them into the native-session host, whose `imports` map resolves their `#` aliases. The other seven linked files hold application source as strings or templates. Every real package import uses a relative `.ts` path, and each link names one file that still produces a raw finding.
