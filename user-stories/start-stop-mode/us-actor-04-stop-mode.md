# US-ACTOR-04 — Stop the current support mode

As a signed-in actor, I want to stop my active support mode with the current context token so that subsequent business requests use my own account identity.

**Status:** Current; source-reviewed HTTP control.
**Access:** Actor authenticated by the configured raw control guard; this story follows an active mode. An authorised idle/absent stop is also accepted as a no-op with unchanged context. API tokens also need the configured `masquerade` ability.
**Entry:** `POST /masquerade/stop` mounted by `masqueradeRoutes()`.
**Documentation:** [Stop with the refreshed token](../../docs/guide/usage.md#stop-with-the-refreshed-token).
**Source:** [MasqueradeController.stop](../../http/controllers.ts), [parseStopControlOrInvalidMarker](../../http/control_input.ts), [MasqueradeService.stop](../../src/service.ts).
**Coverage:** [HTTP controller tests](../../tests/http_controllers.spec.ts), [service transition tests](../../tests/mode_transition.spec.ts).

## Acceptance criteria

| Field or header                               | Control                             | Required/default/conditions                                                      |
| --------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `_masqueradeContext` / `X-Masquerade-Context` | Hidden form field or request header | Must match current context; if both are present they must match                  |
| Shield CSRF token                             | Host field/header                   | Required for cookie-authenticated writes; Masquerade context does not replace it |

- For the active-mode scenario, a successful stop clears the actor's active mode and returns an idle `ModeView` with a new context token.
- Stop always requires the expected token, whatever `contextEnforcement` is set to: a header and hidden field that disagree are rejected with `E_MASQUERADE_CONTEXT_CHANGED`; otherwise a missing or malformed token is rejected with `E_MASQUERADE_CONTEXT_REQUIRED` and a stale one with `E_MASQUERADE_CONTEXT_CHANGED`. A concurrent or lost response requires reading `GET /masquerade`; clients must not automatically replay the old stop.
- Token transport also requires the configured `masquerade` ability; the ability does not grant edit access or bypass host policy.

The [raw controls and optional HTML adapter](us-actor-01-start-stop-mode.md#raw-controls-and-the-optional-html-adapter) share the stop validation and audit boundary. A JSON stop may supply the context header with an explicitly empty body. Unknown stop fields or an unparsed, non-empty payload cannot stop a mode.

## User flow

```mermaid
flowchart TD
    A["Actor submits stop with rendered context and CSRF"] --> B{"Context still current?"}
    B -->|No| C["Refresh status and rebuild the intended action"]
    B -->|Yes| D["Stop active mode"]
    D --> E{"Stop succeeds?"}
    E -->|No| F["Receive refusal and refresh status"]
    E -->|Yes| G["Return to actor identity with new context token"]
```

## Code flow

Scope: active-mode scenario through the raw-guarded stop control, service transition and response; idle/absent success is a no-op.

```mermaid
flowchart TD
    A["MasqueradeController.stop"] --> B["MasqueradeController.control"]
    B --> C["runtimeFor and raw-guard check"]
    C --> D["parseStopControlOrInvalidMarker(ctx)"]
    D --> E["runtime.service.stop(ctx, input); authenticate actor and read row"]
    E --> F{"Input and context valid?"}
    F -->|No| H["MasqueradeError response path"]
    F -->|Yes| Q{"Row active?"}
    Q -->|No| K["Record control_noop; return unchanged idle context"]
    K -->|Audit write failure| H
    Q -->|Yes| G["Commit idle transition; expired if lapsed, otherwise stopped"]
    G -->|Failure| H
    G -->|Applied| I["Return idle ModeView with rotated contextToken"]
```

**Code references:** [controller](../../http/controllers.ts), [stop parser](../../http/control_input.ts), [service stop](../../src/service.ts), [context check](../../src/context_token.ts), [context guide](../../docs/guide/security.md#context-tokens-and-browser-clients), [stop guide](../../docs/guide/usage.md#stop-with-the-refreshed-token).
