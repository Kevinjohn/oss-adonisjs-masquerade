# US-AUDIT-01 — Attach actor and target identity to a host audit record

As an application developer, I want the safe actor and effective identity fields for the current request so that my own business audit record shows who acted and whose account was affected.

**Status:** Current; source-reviewed helper, not runtime-tested.
**Access:** Host handler on a route covered by the Masquerade auth setup, after the host's own authorisation and business write.
**Entry:** `await masqueradeAuditFields(ctx)` from `@kevinjohn/adonisjs-masquerade/http`, spread into the host's audit writer.
**Documentation:** [Audit business work](../../docs/guide/audit.md).
**Source:** [masqueradeAuditFields](../../http/audit_fields.ts).
**Coverage:** [Audit field tests](../../tests/http_audit_fields.spec.ts).

## Acceptance criteria

- The returned frozen object always has the keys `actorId`, `actorIncarnation`, `effectiveId`, `effectiveIncarnation`, `isMasquerading`, `modeId` and `access`.
- On a raw route with a single mapped actor adapter, both identities are the actor, `isMasquerading` is `false`, `modeId` and `access` are `null`, and no mode is admitted, invalidated or reported.
- An ambiguous or unmapped native selection cannot supply actor fields. The helper propagates the runtime failure before the host can record an identity.
- On an effective route during an admitted active mode, the effective identity is the target and `modeId` and `access` come from the mode.
- The package writes no business audit record; the host's writer and transaction own persistence. The package's own control ledger stays separate.

## User flow

```mermaid
flowchart TD
    A["Handler finishes the authorised business write"] --> B["Call masqueradeAuditFields"]
    B --> C{"Mode active on this request?"}
    C -->|Yes| D["Fields name actor, target, mode and access"]
    C -->|No| E["Fields name the actor as both identities"]
    B -->|Identity resolution fails| X["No identity fields; propagate refusal"]
    D --> F["Host writes its audit record"]
    E --> F
```

## Code flow

Scope: field resolution only; the host audit writer is application-owned.

```mermaid
flowchart TD
    A["masqueradeAuditFields(ctx)"] --> B["resolveRuntime(ctx)"]
    B --> C{"runtime.selectGuard(ctx).kind is effective?"}
    C -->|No| D["runtime.actor(ctx); actor as both identities"]
    C -->|Yes| E["runtime.service.resolve(ctx) runs memoised admission"]
    E --> G{"Admitted?"}
    G -->|Yes| F["Return frozen fields"]
    G -->|"Expired or invalidated mode"| H["Throw E_MASQUERADE_CONTEXT_CHANGED"]
    G -->|"Store or policy failure"| I["Throw E_MASQUERADE_UNAVAILABLE"]
    G -->|Request-local policy refusal| J["Throw E_MASQUERADE_NOT_ALLOWED"]
    D -->|Actor resolved| F
    D -->|No mapped actor or invalid credentials| X["Propagate refusal"]
```

**Code references:** [audit fields](../../http/audit_fields.ts), [audit guide](../../docs/guide/audit.md).
