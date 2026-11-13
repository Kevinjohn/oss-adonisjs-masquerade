# US-OPS-04 — Revoke one or all active support modes

As a host operator, I want to stop a selected actor's mode or confirm stopping all modes so that I can revoke active support access during operations or incident response.

**Status:** Operator; Ace stop command is available when configured.
**Access:** Host operator with server command access and control-store access.
**Entry:** `node ace masquerade:stop --actor id [--incarnation value]` or `node ace masquerade:stop --all [--force]`.
**Documentation:** [See and end active modes](../../docs/guide/operations.md#see-and-end-active-modes).
**Source:** [StopCommand](../../commands/stop.ts), [stopActiveModes](../../src/stop_modes.ts).
**Coverage:** [Stop command tests](../../tests/mode_commands.spec.ts), [stop mode tests](../../tests/stop_modes.spec.ts).

## Acceptance criteria

| Option          | Control      | Required/default/conditions                                           |
| --------------- | ------------ | --------------------------------------------------------------------- |
| `--actor`       | String flag  | Required unless `--all`; actor account ID                             |
| `--incarnation` | String flag  | Optional with `--actor`; disambiguates a deleted/reused actor account |
| `--all`         | Boolean flag | Selects every active mode; mutually exclusive with actor/incarnation  |
| `--force`       | Boolean flag | Skips confirmation for `--all` only                                   |

- Exactly one of `--actor` or `--all` is required; incarnation is allowed only with actor.
- `--all` prompts “End every active masquerade mode?” unless `--force`; declining reports “Nothing stopped.”
- A well-formed explicit owner with no active matching row returns zero; resolving an omitted incarnation may fail if the actor cannot be found. Invalid input or unavailable storage returns an error. Success reports actual stopped transitions: expired rows clear without increasing that count, and contention can leave modes active after `--all`. Check status and retry remaining work.

## User flow

```mermaid
flowchart TD
    A["Run masquerade:stop with actor or all"] --> B{"Valid mutually exclusive options?"}
    B -->|No| C["See usage error"]
    B -->|Actor| D["Stop that actor's mode"]
    B -->|All| E{"Confirm or pass force?"}
    E -->|Decline| F["Nothing is stopped"]
    E -->|Confirm| G["Attempt to stop active modes"]
    D --> H{"Selection resolves and operation succeeds?"}
    G --> I["Report actual stopped count, possibly zero; check status and retry contention"]
    H -->|No| J["See input, unresolved incarnation or unavailable error"]
    H -->|Yes| I
```

## Code flow

Scope: CLI operator request through `stopActiveModes` and per-owner state transitions.

```mermaid
flowchart TD
    A["StopCommand.run"] --> B["Validate actor/all/incarnation flags"]
    B --> C{"all and force is false?"}
    C -->|Yes| D["Prompt for confirmation"]
    D -->|Declined| E["Log Nothing stopped and return"]
    D -->|Confirmed| F{"this.all?"}
    C -->|No| F
    F -->|Yes| G["stopActiveModes with selector all"]
    F -->|No| H["stopActiveModes with actor and incarnation"]
    G --> I["Emit transitions and count stopped modes"]
    H --> I
    I --> J["Log actual stopped count, including zero; errors remain errors"]
```

**Code references:** [StopCommand](../../commands/stop.ts), [stopActiveModes](../../src/stop_modes.ts), [operator guide](../../docs/guide/operations.md#see-and-end-active-modes).
