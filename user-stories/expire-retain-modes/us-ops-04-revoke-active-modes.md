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
- The command uses the configured authority when supplied. If omitted, it reads the authority from the [configured runtime](../configure-masquerade/us-setup-03-register-integration-callbacks.md).
- A well-formed explicit owner with no active matching row returns zero; resolving an omitted incarnation may fail if the actor cannot be found. Invalid input or unavailable storage returns an error. A successful operator stop records an `invalidated` event, not `stopped`; expired rows clear with `expired` without increasing the stopped count. Bulk stop scans batches of 100 until empty or a batch makes no progress; single-actor stop retries a conflict up to three times. Contention can leave modes active after `--all`. Check status and retry remaining work. Bulk failures report the confirmed count and any indeterminate commit; `E_MASQUERADE_STOP_PROGRESS` is a class with public code `E_MASQUERADE_UNAVAILABLE`.

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
    G --> H
    H -->|No| J["See input, unresolved incarnation or unavailable error"]
    H -->|Yes| I["Report actual stopped count, possibly zero; check status and retry contention"]
```

## Code flow

Scope: CLI operator request through `stopActiveModes` and per-owner state transitions.

```mermaid
flowchart TD
    A["StopCommand.run"] --> B{"Valid actor/all/incarnation flags?"}
    B -->|No| X["Log usage error; exitCode 1"]
    B -->|Yes| C{"all and force is false?"}
    C -->|Yes| D["Prompt for confirmation"]
    D -->|Declined| E["Log Nothing stopped and return"]
    D -->|Confirmed| P{"Masquerade config provides authority?"}
    C -->|No| P
    P -->|Config missing| Z["Throw InvalidArgumentsException"]
    P -->|Authority supplied| F{"this.all?"}
    P -->|Authority omitted| R["Resolve masquerade.runtime and use runtime.config.authority"]
    R --> F
    F -->|Yes| G["stopActiveModes with selector all"]
    F -->|No| H["stopActiveModes with actor and incarnation"]
    G --> I["CAS invalidated or expired transitions; count applied invalidations"]
    H --> I
    I -->|Success| J["Log actual stopped count and report stalled bulk scan"]
    I -->|Invalid selection| X2["Log input error and set exitCode 1"]
    I -->|Bulk progress error| Y["completed reports phase, confirmed count and any indeterminate commit"]
    I -->|Other failure| Z2["Propagate error"]
```

**Code references:** [StopCommand](../../commands/stop.ts), [stopActiveModes](../../src/stop_modes.ts), [operator guide](../../docs/guide/operations.md#see-and-end-active-modes).
