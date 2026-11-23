# US-OPS-03 — Expire lapsed modes and prune retained events

As a host operator, I want a scheduled bounded cleanup pass so that expired modes and events beyond the configured retention are removed without adding a package-owned background worker.

**Status:** Operator; Ace housekeeping command is available when configured.
**Access:** Host operator with scheduler and control-store access.
**Entry:** Schedule `node ace masquerade:prune [--batch-size n]`.
**Documentation:** [Schedule recurring cleanup](../../docs/guide/operations.md#schedule-recurring-work), [retention scope](../../docs/guide/operations.md#event-retention-and-store-scope).
**Source:** [PruneCommand](../../commands/prune.ts), [pruneMasquerade](../../src/prune.ts).
**Coverage:** [Prune command tests](../../tests/prune_command.spec.ts), [prune service tests](../../tests/prune.spec.ts).

## Acceptance criteria

| Option         | Control     | Required/default/conditions                  |
| -------------- | ----------- | -------------------------------------------- |
| `--batch-size` | Number flag | Defaults to 100; safe integer from 1 to 1000 |

- One invocation prunes a bounded batch of eligible events first, then processes one bounded batch of expired mode rows; compare-and-set protects mode transitions. It clears expired rows to idle rather than deleting the mode rows. Ace exits with code 1 on failure. A housekeeping operation failure produces one diagnostic with the failed phase and confirmed counts, plus a notice if that operation may have committed. Ace uses its usual diagnostic for validation or setup failures.
- Configured event retention applies to every namespace visible through the store; use a scoped store for different retention periods. `host-managed` event retention is not pruned by this command.
- No background worker starts automatically; the host scheduler must invoke this command.

## User flow

```mermaid
flowchart TD
    A["Host scheduler invokes masquerade:prune"] --> B["Set bounded batch size"]
    B --> C["Run bounded event retention and then expire eligible modes"]
    C -->|Pass succeeds| E["See counts for this pass"]
    C -->|Housekeeping operation fails| R["See one diagnostic with phase, confirmed counts and any commit uncertainty"]
    B -->|Argument or setup failure| T["See the usual Ace error"]
    R --> U["Ace exits with code 1"]
    T --> U
```

## Code flow

Scope: one command invocation; host recurrence and alerting remain outside the package.

```mermaid
flowchart TD
    A["PruneCommand.run"] --> B["Validate batchSize and load config and services"]
    B --> C["pruneMasquerade(config, dependencies, options)"]
    C --> D["defineConfig and openControlStore"]
    B -->|Validation or setup fails| Y["Ace stores the error and sets exit code 1"]
    D -->|Setup fails| Y
    D -->|Retention enabled| E["store.pruneEvents"]
    D -->|Host-managed retention| F["store.expiredBatch"]
    E -->|Retention succeeds| F
    E -->|Retention fails| X["Throw PruneProgressError with phase, confirmed counts and uncertainty"]
    F -->|Batch fails| X
    F --> G["Read candidate and compare-and-set clear per owner"]
    G --> H["Return expired and eventsDeleted counts, skipping conflicts"]
    G -->|Candidate, read or commit fails| X
    H --> I["Log result"]
    X --> Y
    Y --> Z{"PruneCommand.completed sees PruneProgressError?"}
    Z -->|Yes| P["Log progress once and return true"]
    Z -->|No| Q["Return false so Ace renders the error"]
```

**Code references:** [PruneCommand](../../commands/prune.ts), [pruneMasquerade](../../src/prune.ts), [schedule guide](../../docs/guide/operations.md#schedule-recurring-work).
