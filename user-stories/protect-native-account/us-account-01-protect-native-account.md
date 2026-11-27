# US-ACCOUNT-01 — Keep native account operations on the actor account

As an application developer integrating Account Kit, I want account-management routes to use the raw actor guard and block managed actions during an active mode so that support mode cannot change the support operator's own account unintentionally.

**Status:** Current when the host opts into the Account Kit blocker.
**Access:** Host route configuration; blocker checks the authenticated raw account and its active mode.
**Entry:** Apply `AccountKitAccountBlocker` and raw guard to native account routes; keep logout and CSRF outside the blocked group.
**Documentation:** [Account Kit integration](../../docs/guide/account-kit.md#block-host-owned-account-routes), [security boundary](../../docs/guide/security.md#account-kit-admission-and-managed-actions).
**Source:** [AccountKitAccountBlocker](../../src/account_kit/account_blocker_middleware.ts), [Account Kit example routes](https://github.com/Kevinjohn/oss-adonisjs-starter-examples/blob/v0.17.0/apps/hypermedia/start/routes.ts).
**Coverage:** [Blocker tests](../../tests/account_kit_account_blocker.spec.ts), [Account Kit route tests](../../examples/account_kit/tests/functional/account_kit_routes.spec.ts).

## Acceptance criteria

- Host applies the blocker to account registration/management operations and authenticates them with the raw guard, not the effective target identity.
- When unauthenticated, the blocker continues to the route's normal guest/auth handling. When authenticated and the actor has an unexpired active mode, it throws `E_MASQUERADE_ACTION_BLOCKED` with `blockedBy: sensitive`.
- Logout and CSRF routes remain outside the blocked group so the actor can end their native session.
- The package cannot enforce this boundary on host routes where the middleware/guard is omitted. For host-owned account routes `masquerade:routes` can report `Account Kit blocker registered` for the recognised named middleware reference, as well as guard category and route markers; this is diagnostic, not enforcement. It classifies only `accountKit.*` route names as Account Kit managed.

## User flow

```mermaid
flowchart TD
    A["Actor requests a native account action"] --> R{"Logout or CSRF?"}
    R -->|No| B{"Raw actor authenticated?"}
    B -->|No| C["Continue to normal guest or auth response"]
    B -->|Yes| D{"Actor has unexpired active support mode?"}
    D -->|Yes| E["Refuse managed account action"]
    D -->|No| F["Continue as raw actor"]
    R -->|Yes| H["Route stays outside the blocker"]
```

## Code flow

Scope: opt-in middleware boundary on host-managed Account Kit routes.

```mermaid
flowchart TD
    A["Host route group runs AccountKitAccountBlocker.handle"] --> B["Resolve NativeAdapter and managed raw guard"]
    B --> C["raw.check()"]
    C --> D{"Authenticated?"}
    D -->|No| E["next()"]
    D -->|Yes| F["provider.createUserForGuard and resolveAccountOwner"]
    F --> G["resolveRuntime(ctx).activeMode"]
    G --> H{"Mode active and not expired?"}
    H -->|Yes| I["Throw E_MASQUERADE_ACTION_BLOCKED"]
    H -->|No| E
    C -->|Guard failure| J["Return E_MASQUERADE_UNAVAILABLE"]
    F -->|Identity resolution failure| J
    G -->|Store failure| J
```

**Code references:** [blocker](../../src/account_kit/account_blocker_middleware.ts), [example route grouping](https://github.com/Kevinjohn/oss-adonisjs-starter-examples/blob/v0.17.0/apps/hypermedia/start/routes.ts), [integration guide](../../docs/guide/account-kit.md#block-host-owned-account-routes), [route report classification](../../commands/routes.ts), [recognised markers](../../src/integration/route_markers.ts).
