# US-OPS-02 — Review route coverage for Masquerade

As an application maintainer, I want a route coverage report so that I can find control routes, effective-guard business routes, raw-guard routes, markers and unresolved handlers before enabling support access.

**Status:** Operator; Ace report is available when app config and route registration load.
**Access:** Application maintainer with command access.
**Entry:** `node ace masquerade:routes`.
**Documentation:** [Route report](../../docs/guide/route-report.md).
**Source:** [RoutesCommand and inspectRouteCoverage](../../commands/routes.ts).
**Coverage:** [Routes command tests](../../tests/routes_command.spec.ts), [managed route report and blocker agreement](../../tests/account_kit_provider.spec.ts), [route metadata tests](../../tests/route_metadata.spec.ts).

## Acceptance criteria

- The command requires `config/masquerade`, resolves effective and raw guard names, commits the router, and reports each registered route's methods and pattern. Host-owned routes include guard categories and recognised markers. Managed `accountKit.*` routes instead report their managed or unclassified category and READ/MUTATION label without inspecting guards or route markers.
- Package control handlers are identified by controller/method; unresolved handlers, possible name-inferred controls, unprotected routes, unsupported mixed guards and distinct effective transports remain visible for human review. Supported host-owned account blocker references receive their own label.
- The global blocker and report share the `accountKit.*` route-name rule. With verified registration, logout and CSRF are labelled `Account Kit managed (exempt)` and ordinary managed routes are labelled `Account Kit managed (blocked while active)`. Without verification, every managed route is `UNCLASSIFIED` with a missing or unverified blocker note.
- The report is diagnostic only. It does not change route definitions or enforce authorisation.

## User flow

```mermaid
flowchart TD
    A["Run node ace masquerade:routes"] --> B["Review sections grouped by guard"]
    B --> C{"Find unclassified or unresolved entries?"}
    C -->|Yes| D["Inspect route and correct wiring or document rationale"]
    C -->|No| E["Continue release review"]
    D --> F["Run the report again after wiring changes"]
```

## Code flow

Scope: committed route metadata analysis; report output does not enforce route behaviour.

```mermaid
flowchart TD
    A["RoutesCommand.run"] --> B["Load masquerade config, router and auth manager"]
    B --> C["router.commit and router.toJSON"]
    C --> A2{"Configured authority supplied?"}
    A2 -->|Yes| S["Read hasVerifiedAccountKitBlocker status"]
    A2 -->|No| R["Use resolved runtime authority"]
    R --> S
    S --> D["inspectRouteCoverage with authority.guard and blocker status"]
    D --> Q{"classifyAccountKitRoute by committed route name"}
    Q -->|Managed or exempt| V{"Blocker verified?"}
    V -->|Yes| X["Label blocked while active or exempt"]
    V -->|No| U["Label UNCLASSIFIED with missing or unverified blocker note"]
    Q -->|Host| E["Resolve registered account blocker, routeGuards and routeMarkers"]
    E --> F["classifyPackageControl and host-control checks"]
    X --> G["Group and label route lines"]
    U --> G
    F --> G
    G --> H["logger.info report sections"]
```

**Code references:** [RoutesCommand and report](../../commands/routes.ts), [shared route classification](../../src/integration/account_kit_route_classification.ts), [global blocker](../../src/account_kit/middleware.ts), [provider verification](../../providers/account_kit_provider.ts), [route marker resolver](../../src/integration/route_markers.ts).
