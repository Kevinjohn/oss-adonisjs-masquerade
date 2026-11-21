# US-SETUP-02 — Select the credential transport for each route

As an application developer, I want to bind each effective guard to the intended native credential so that a request carrying both a cookie and a bearer token resolves the correct actor.

**Status:** Current under the stated integration.
**Access:** Application developer
**Entry:** Host auth configuration and native adapter registration.
**Documentation:** [Access tokens](../../docs/guide/access-tokens.md).
**Source:** [Runtime](../../src/integration/runtime_factory.ts), [Route selection](../../src/integration/route_guard_selection.ts).
**Coverage:** [Live guard configuration](../../tests/runtime_guard_configuration.spec.ts), [Route selection](../../tests/route_guard_selection.spec.ts).

## Acceptance criteria

- Register the primary raw guard and a matching adapter for each integrated raw transport. Configure an effective default guard. A missing raw factory, unbound effective factory or mismatched declared driver fails configuration.
- On an effective route the runtime constructs the selected guards with the live request and compares both driver names before authenticating the actor or reading the store. A cross-wired factory fails with `E_MASQUERADE_UNAVAILABLE`.
- On the token route the token adapter supplies the actor even if a different actor has a session cookie. Unrelated raw guards can still serve native routes. An ambiguous or unbound raw selection cannot enter the Masquerade service.

## User flow

```mermaid
flowchart TD
    A["Register guard pair"] --> B["Call a route with credentials"]
    B["Call a route with credentials"] --> C["Use only the selected transport"]
```

## Code flow

```mermaid
flowchart TD
    A["Select route guards"] --> B["Verify live drivers"]
    B["Verify live drivers"] --> C["Authenticate actor through adapter"]
```
