# US-SETUP-01 — Configure policy, authority and request wiring

As an AdonisJS application developer, I want to scaffold and finish Masquerade integration so that control routes and business requests use the host's intended identity and policy boundaries.

**Status:** Operator; current Ace setup path.
**Access:** Application developer with permission to configure providers, routes, middleware and schema.
**Entry:** `node ace configure @kevinjohn/adonisjs-masquerade`; host config is completed from the emitted steps.
**Documentation:** [Setup guide](../../docs/guide/setup.md), [configuration guide](../../docs/guide/getting-started.md).
**Source:** [configure](../../configure.ts), [host wiring](../../src/configure_wiring.ts), [config validation](../../src/define_config.ts).
**Coverage:** [Configure tests](../../tests/configure.spec.ts), [host wiring tests](../../tests/configure_wiring.spec.ts).

## Acceptance criteria

- The command requires configured Adonis auth, a resolvable user model, assembler and Lucid. It accepts the configured namespace and raw guard; invalid values stop with an error.
- Existing generated files are preserved unless `--force` is supplied. Optional `--banner` and `--form-controller` add those host scaffolds; `--no-wire` leaves auth/kernel/routes wiring steps for the maintainer.
- The command creates configuration, native authority/user provider/context middleware and migration stubs, registers provider and Ace commands, and wires recognized auth/kernel/route shapes when enabled.
- Host completes account incarnation, security stamp, active-account and deny-by-default `canMasquerade` policy behavior, reviews and applies the migration, and verifies context enforcement before enforcing it.
- `defineConfig` normalizes and validates config. Custom authorities/stores are explicit host integrations; this scaffold does not infer their policy.

## User flow

```mermaid
flowchart TD
    A["Run Ace configure with namespace and raw guard"] --> B{"Auth, user model, assembler and Lucid available?"}
    B -->|No| C["See setup error and satisfy prerequisite"]
    B -->|Yes| D{"Generated destination already exists?"}
    D -->|Yes without force| E["Existing files remain unchanged; review or rerun with force"]
    D -->|No or force| F["Review generated config, provider, migration and host wiring"]
    F --> G["Implement host policy and apply migration"]
    G --> H["Exercise status/start/stop and context-protected routes"]
```

## Code flow

Scope: Ace codemod scaffolding and recognized host wiring; host-specific policy implementation remains application-owned.

```mermaid
flowchart TD
    A["configure(command)"] --> B["readOption namespace and guard"]
    B --> C["fileExists auth, user model, assembler, Lucid"]
    C --> D{"Prerequisites and names valid?"}
    D -->|No| E["Log setup error and set exitCode"]
    D -->|Yes| F["codemods.makeUsingStub generated files"]
    F --> G["codemods.updateRcFile registers providers and commands"]
    G --> H{"noWire(command)?"}
    H -->|Yes| I["Print required host wiring steps"]
    H -->|No| J["wireHost(command, codemods, guard, banner, formController)"]
    J --> K["Print migration, policy and enforcement steps"]
```

**Code references:** [configure](../../configure.ts), [wireHost](../../src/configure_wiring.ts), [defineConfig](../../src/define_config.ts), [setup guide](../../docs/guide/setup.md).
