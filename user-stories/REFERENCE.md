# Catalogue reference

## Source baseline and scope

Fetched `origin/main` baseline: [`d9e279d715762376ebc07cf199bee0ae59838954`](https://github.com/Kevinjohn/oss-adonisjs-masquerade/commit/d9e279d715762376ebc07cf199bee0ae59838954). Inventory covers public package exports, setup scaffolds, HTTP control routes, effective guards, context and route markers, Account Kit blocker, Ace operator commands, guides, examples and relevant tests.

## Roles and boundaries

- **Actor/operator:** the signed-in account that starts a support mode and retains its raw credential.
- **Target:** account selected for effective business identity; the package does not receive or mint the target's credential.
- **Host policy owner:** application developer who implements `canMasquerade`, optional `canEdit` and request policy, account eligibility and security stamps.
- **Host operator:** person with server command/scheduler access to inspect, stop or prune modes.

These terms describe integration roles. They are not framework roles or a built-in authorization model. Effective account permissions remain those of the target, and every host business handler still runs its own authorization. The package has no end-user UI; optional generated form/controller/banner stubs are host-owned integration artifacts.

## Availability and evidence

Current means an entry exists subject to configuration, guard selection, policies and middleware order. Operator means an Ace command or deployment task outside ordinary business UI. No browser or application runtime journey was run for this documentation change; linked tests are evidence locations only.

## Source map

| Capability                            | Entry and implementation                                                                                                                                                    | Authority                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Scaffolding and host wiring           | [configure](../configure.ts), [wireHost](../src/configure_wiring.ts)                                                                                                        | [Setup guide](../docs/guide/setup.md)                                                                            |
| Status/start/stop HTTP controls       | [masqueradeRoutes](../http/control_routes.ts), [MasqueradeController](../http/controllers.ts), [control_input](../http/control_input.ts)                                    | [Usage guide](../docs/guide/usage.md)                                                                            |
| API-client test support               | [masqueradeApiClient](../plugins/api_client.ts)                                                                                                                             | [Testing guide](../docs/guide/testing.md)                                                                        |
| Active request identity and admission | [EffectiveSessionGuard](../auth/effective_session_guard.ts), [EffectiveAccessTokensGuard](../auth/effective_access_tokens_guard.ts), [MasqueradeService](../src/service.ts) | [Technical contract](../docs/maintainers/design/spec-masquerade.md), [security guide](../docs/guide/security.md) |
| Context and mutation route checks     | [masqueradeContext](../http/context_middleware.ts), [route markers](../src/integration/route_markers.ts)                                                                    | [Security guide](../docs/guide/security.md#context-tokens-and-browser-clients)                                   |
| Account Kit managed actions           | [AccountKitAccountBlocker](../account_kit/middleware.ts)                                                                                                                    | [Account Kit guide](../docs/guide/account-kit.md#block-host-owned-account-routes)                                |
| Operator status, stop, report, prune  | [Ace commands](../commands/status.ts), [stop](../commands/stop.ts), [routes](../commands/routes.ts), [prune](../commands/prune.ts)                                          | [Operations guide](../docs/guide/operations.md)                                                                  |
| Authority/store integration           | [native authorities](../native/native_authorities.ts), [control store](../stores/lucid.ts), [memory store](../testing/memory_control_store.ts)                              | [Custom authorities](../docs/guide/custom-authorities.md), [custom stores](../docs/guide/custom-stores.md)       |
