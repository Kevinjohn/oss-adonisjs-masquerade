# US-SETUP-01 — Configure policy, authority and request wiring

As an AdonisJS application developer, I want to scaffold and finish Masquerade integration so that control routes and business requests use the host's intended identity and policy boundaries.

**Status:** Operator; current Ace native-session scaffold.
**Access:** Application developer with permission to configure providers, routes, middleware and schema.
**Entry:** `node ace configure @kevinjohn/adonisjs-masquerade`; host config is completed from the emitted steps.
**Documentation:** [Setup guide](../../docs/guide/setup.md), [configuration guide](../../docs/guide/getting-started.md).
**Source:** [configure](../../configure.ts), [host wiring](../../src/configure_wiring.ts), [config validation](../../src/define_config.ts).
**Coverage:** [Configure tests](../../tests/configure.spec.ts), [host wiring tests](../../tests/configure_wiring.spec.ts).

## Acceptance criteria

| Input             | Control                                          | Required/default/conditions                                                    |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Namespace         | `--namespace` or **Masquerade namespace** prompt | Required; no default. 1–128 ASCII bytes matching `[A-Za-z0-9][A-Za-z0-9_.:-]*` |
| Raw session guard | `--guard` or **Raw session guard name** prompt   | Required; no default. 1–128 ASCII bytes matching `[A-Za-z][A-Za-z0-9_-]*`      |

- Omitted flags prompt for their values. Invalid names stop with an error before scaffolding.
- The command requires configured Adonis auth, a resolvable user model, assembler and Lucid. A `package.json` that cannot be read or is not JSON stops the command with that error before files are written. When no database config is already loaded, configure imports `config/database.ts`; if that file exists but fails to load, the error stops the command before files are written. Without `package.json` the user model is `app/models/user`; without a configured migrations path the migration goes to `database/migrations`.
- Without `--force`, any existing generated destination stops the command with an error and exit code 1 before files are written; if a stub is nonetheless skipped, the command stops with exit code 1 before providers or commands are registered. `--force` replaces existing generated files. Optional `--banner` and `--form-controller` add those host scaffolds; `--no-wire` leaves auth/kernel/routes wiring steps for the maintainer.
- The command creates native-session configuration, authority/user provider/context middleware and migration stubs, registers provider and Ace commands, and wires recognized session auth/kernel/route shapes when enabled.
- Native opaque access-token integration is host-configured separately with an effective token guard and authority, as described in the [access-token guide](../../docs/guide/access-tokens.md). Configure does not automatically wire token authentication.
- Host completes account incarnation, security stamp, active-account and deny-by-default `canMasquerade` policy behavior, reviews and applies the migration, and verifies context enforcement before enforcing it.
- `defineConfig` normalizes and validates config. Custom authorities/stores are explicit host integrations; this scaffold does not infer their policy.

## User flow

```mermaid
flowchart TD
    A["Run Ace configure; provide names by flags or prompts"] --> N{"Names valid?"}
    N -->|No| O["See name error and correct input"]
    N -->|Yes| B{"Auth, user model, assembler and Lucid available; package.json (when present) and any needed database config load?"}
    B -->|No| C["See setup error and satisfy prerequisite"]
    B -->|Yes| D{"Generated destination already exists?"}
    D -->|Yes without force| E["Existing files remain unchanged; review or rerun with force"]
    D -->|No or force| S{"Any generated path skipped?"}
    S -->|Yes| T["See partial-files error; nothing registered; review and rerun with force"]
    S -->|No| F["Review generated config, provider, migration and host wiring"]
    F --> G["Implement host policy and apply migration"]
    G --> H["Exercise status/start/stop and context-protected routes"]
```

## Code flow

Scope: Ace native-session scaffolding and recognized session host wiring; host-specific policy implementation remains application-owned.

```mermaid
flowchart TD
    A["configure(command)"] --> B["readOption namespace and guard; prompt when omitted"]
    B --> N{"isNamespace and isGuardName valid?"}
    N -->|No| E["Log setup error and set exitCode"]
    N -->|Yes| C["Check prerequisites; userModelPath reads package.json; migrationsFolder uses loaded config or databaseConfig"]
    C -->|"package.json read/parse or databaseConfig throws"| R["Error propagates; nothing written"]
    C --> D{"Prerequisites available?"}
    D -->|No| E
    D -->|Yes| X{"Destinations exist and no force?"}
    X -->|Yes| Y["Log existing-files error, exitCode 1, stop"]
    X -->|No| F["codemods.makeUsingStub generated files"]
    F --> Z{"Any stub skipped?"}
    Z -->|Yes| Y2["Log skipped-paths error, exitCode 1, stop before registration"]
    Z -->|No| G["codemods.updateRcFile registers providers and commands"]
    G --> H{"noWire(command)?"}
    H -->|Yes| I["Print required host wiring steps"]
    H -->|No| J["wireHost(command, codemods, guard, banner, formController)"]
    J --> K["Print migration, policy and enforcement steps"]
```

**Code references:** [configure](../../configure.ts), [wireHost](../../src/configure_wiring.ts), [defineConfig](../../src/define_config.ts), [setup guide](../../docs/guide/setup.md).
