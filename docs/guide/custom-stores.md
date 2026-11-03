# Custom control stores

The [`API entry-point map`](../reference/README.md#supported-package-imports) links the
`ControlStore` contract under `adonisjs-masquerade/types`, the built-in adapter under the optional
`adonisjs-masquerade/stores/lucid` path, and the conformance helper under
`adonisjs-masquerade/testing`.

Masquerade stores one mode per owner and appends an audit event for each committed transition. The public `ControlStore` type is exported from `adonisjs-masquerade/types`; a reusable behavioral suite is exported from `adonisjs-masquerade/testing`.

## Contract

The owner key is the complete tuple `(namespace, actorId, actorIncarnation)`. Treat all three values as part of every read, uniqueness constraint, comparison, and event projection. An account ID reused for a new account lifetime has a different owner key when its incarnation changes.

Each mode row stores `access` as nullable `string(8)`: active rows use `'view'` or `'edit'`, while idle rows use `null`. Audit events also store a nullable `access` column. An event written from an active row must carry that row's access level; events without an active row omit the field and persist `NULL`. Validate this projection alongside the event's target and transition identity.

| Operation                        | Required behavior                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read(owner)`                    | Return an independent snapshot for the complete owner key, or `null` as authoritative absence. Mutating a returned object must not mutate stored state.                               |
| `compareAndSet(input)`           | Compare `expected` with the current revision (`null` means no row), and atomically commit `next` plus its matching event. A failed comparison returns `conflict` and changes neither. |
| `recordControlOutcome(event)`    | Append a required denial or no-op event without creating, replacing, or changing the revision of a mode row. A write failure rejects.                                                 |
| `expiredBatch({ now, limit })`   | Return at most `limit` expired active row snapshots. Expiry cleanup re-reads each candidate and uses CAS, so a stale batch cannot clear a newer mode.                                 |
| `activeBatch({ limit })`         | Return at most `limit` active row snapshots, oldest `updatedAt` first, regardless of expiry. Operator commands re-read each candidate and use CAS before ending it.                   |
| `pruneEvents({ before, limit })` | Delete at most `limit` events strictly older than `before`; do not delete mode rows, including idle rows.                                                                             |

For a successful CAS, `next.revision` and the event revision agree and advance exactly once from the expected revision (an absent owner starts at revision 1). The event must describe the same owner and the transition represented by the row: transition ID, mode ID, state, target and incarnation, access, outcome, and reason where applicable. An active row's reason is null, and its `started` event has no reason, when the host's reason policy is optional and none was given. Validate persisted rows and incoming transition/event pairs canonically, including revision progression and event projection. Malformed persisted state must fail closed; do not return a row that the service could interpret as valid.

`applied` means the row and event committed together. `conflict` means the expected revision did not match and this attempt did not commit. `indeterminate` means the commit acknowledgement was lost and the transaction may have committed; preserve and return its transition ID. The caller reports the operation as unavailable and recovers through status. Never turn an uncertain result into a definite failure or retry it as if nothing committed.

Denials and no-ops inside the control-audit boundary append their event while leaving row and revision unchanged. Transitions, including expiry and invalidation, advance the revision and append the corresponding event atomically. Event pruning is bounded and does not undo those row/event agreements for retained events. Idle rows retain their revision and nonce; pruning them could make an old context token valid again.

## Implementing the boundary

The interface is small, but each method needs database-level semantics. A typical adapter uses a unique constraint over the owner tuple, a transaction for the conditional row write and event insert, and driver-aware handling for a commit whose acknowledgement is uncertain. This outline shows where the checks belong; adapt it to your database and keep the operation atomic:

```ts
import type { CompareAndSetInput, ControlStore, OwnerKey } from 'adonisjs-masquerade/types'

export class DatabaseControlStore implements ControlStore {
  async read(owner: OwnerKey) {
    // Select by namespace, actorId, and actorIncarnation; decode and validate;
    // return a detached snapshot or null.
  }

  async compareAndSet(input: CompareAndSetInput) {
    // In one transaction: validate input and projection, conditionally insert/update
    // against input.expected, then append input.event. Roll back on any definite failure.
    // Return conflict when the revision predicate loses; return indeterminate only
    // when commit may have succeeded but its acknowledgement is unknown.
  }

  async recordControlOutcome(event) {
    // Validate and append the event without changing a mode row.
  }

  async expiredBatch({ now, limit }) {
    // Return at most limit detached expired-active snapshots.
  }

  async activeBatch({ limit }) {
    // Return at most limit detached active snapshots, oldest update first.
  }

  async pruneEvents({ before, limit }) {
    // Delete at most limit events with at < before; leave every mode row intact.
  }
}
```

The method bodies are adapter-specific. For example, a local mutex cannot coordinate separate processes or database connections, and a read followed by an unconditional write is not compare-and-set. Enforce the owner uniqueness and revision predicate in the database transaction that also inserts the event.

## Run the conformance suite

Add a test that supplies a newly created, isolated store each time. For a SQL adapter, create a fresh schema/database or clear and migrate a dedicated test database before returning the store; do not point concurrent test runs at shared tables.

```ts
import { test } from '@japa/runner'
import { assertControlStoreConformance } from 'adonisjs-masquerade/testing'
import { createTestDatabase, migrateTestDatabase } from './helpers/database.js'
import { DatabaseControlStore } from '../app/stores/database_control_store.js'

test('database store satisfies the ControlStore contract', async () => {
  await assertControlStoreConformance(async () => {
    const db = await createTestDatabase()
    await migrateTestDatabase(db)
    return new DatabaseControlStore(db)
  })
})
```

Replace the fixture helpers and adapter import with your application's equivalents. The factory is called once per suite run and must return a clean, isolated store. The exported `MemoryControlStore` is useful for tests, but it is an in-process test utility (`testOnly: true`), not a production persistence choice. Its direct malformed-input validation is not a promise that every malformed input is handled identically by a production adapter; implement canonical validation at your adapter boundary.

The conformance suite checks observable contract behavior, including owner isolation, detached reads, competing CAS calls, revision/event agreement, control outcomes, expiry snapshots, and bounded pruning. A pass does not establish database isolation or behavior under independent connections. Add adapter-level tests for the database guarantees your implementation relies on, at least:

- simultaneous CAS through independent connections, including insert-if-absent and update races, with exactly one winner and its event;
- transaction rollback when row or event writes fail, including duplicate-event and constraint failures;
- driver-specific busy, deadlock, retry and commit-acknowledgement failure behavior, proving that safe retries retain the same transition ID and uncertain commits return `indeterminate`;
- concurrent expiry cleanup and start/stop so an old batch cannot clear a newer mode;
- any database-specific row decoding and revision limits, such as safe parsing of PostgreSQL `BIGINT` values.

The built-in Lucid adapter's SQLite and PostgreSQL tests are examples of these supplemental checks; the conformance suite alone cannot replace tests against your chosen database and driver.
