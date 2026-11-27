# Catalogue reference

## Source baseline and scope

Source baseline: [`4a7022eba8375424cf7b2852417ace11569713d4`](https://github.com/Kevinjohn/oss-adonisjs-masquerade/commit/4a7022eba8375424cf7b2852417ace11569713d4). Inventory covers public package exports, setup scaffolds, HTTP control routes, effective guards, context and route markers, Account Kit blocker, Ace operator commands, guides, examples and relevant tests.

## Roles and boundaries

- **Actor/operator:** the signed-in account that starts a support mode and retains its raw credential.
- **Target:** account selected for effective business identity; the package does not receive or mint the target's credential.
- **Host policy owner:** application developer who implements `canMasquerade`, optional `canEdit` and request policy, account eligibility and security stamps.
- **Host operator:** person with server command/scheduler access to inspect, stop or prune modes.

These terms describe integration roles. They are not framework roles or a built-in authorisation model. Effective account permissions remain those of the target, and every host business handler still runs its own authorisation. The package has no end-user UI; optional generated form/controller/banner stubs are host-owned integration artifacts.

The [package provider](../providers/masquerade_provider.ts) resolves the configured runtime at boot. Hosts can register an adapter and policy through [US-SETUP-03](configure-masquerade/us-setup-03-register-integration-callbacks.md). Standalone service creation requires authority and policy in its supplied config.

## Availability and evidence

Current means an entry exists subject to configuration, guard selection, policies and middleware order. Operator means an Ace command or deployment task outside ordinary business UI. No browser or application runtime journey was run for this documentation change; linked tests are evidence locations only.

## Source map

| Capability                            | Entry and implementation                                                                                                                                                                                           | Authority                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Scaffolding and host wiring           | [configure](../configure.ts)                                                                                                                                                                                       | [Setup guide](../docs/guide/setup.md)                                                                                 |
| Status/start/stop HTTP controls       | [MasqueradeRuntime.registerRoutes](../src/integration/runtime.ts), [MasqueradeController](../src/http/masquerade_controller.ts), [control_input](../src/http/control_input.ts)                                     | [Usage guide](../docs/guide/usage.md)                                                                                 |
| API-client test support               | [masqueradeApiClient](../src/plugins/api_client.ts)                                                                                                                                                                | [Testing guide](../docs/guide/testing.md)                                                                             |
| Active request identity and admission | [EffectiveSessionGuard](../src/auth/effective_session_guard.ts), [EffectiveAccessTokensGuard](../src/auth/effective_access_tokens_guard.ts), [MasqueradeService](../src/service.ts)                                | [Technical contract](../docs/maintainers/design/spec-masquerade.md), [security guide](../docs/guide/security.md)      |
| Context and mutation route checks     | [masqueradeContext](../src/http/context_middleware.ts), [route markers](../src/integration/route_markers.ts)                                                                                                       | [Security guide](../docs/guide/security.md#context-tokens-and-browser-clients)                                        |
| Account Kit managed actions           | [AccountKitBlocker](../src/account_kit/managed_blocker_middleware.ts) and [AccountKitAccountBlocker](../src/account_kit/account_blocker_middleware.ts), [AccountKitProvider](../providers/account_kit_provider.ts) | [Account Kit guide](../docs/guide/account-kit.md#block-host-owned-account-routes)                                     |
| Operator status, stop, report, prune  | [Ace commands](../commands/status.ts), [stop](../commands/stop.ts), [routes](../commands/routes.ts), [prune](../commands/prune.ts)                                                                                 | [Operations guide](../docs/guide/operations.md)                                                                       |
| Authority/store integration           | [native authorities](../src/native/native_authorities.ts), [control store](../src/stores/lucid.ts), [memory store](../src/testing/memory_control_store.ts)                                                         | [Custom authorities](../docs/guide/custom-authorities.md), [custom stores](../docs/guide/custom-stores.md)            |
| Edge helpers and audit fields         | [masqueradeEdge and contextField](../src/http/edge.ts), [masqueradeAudit](../src/http/audit_fields.ts)                                                                                                             | [Security guide](../docs/guide/security.md#context-tokens-and-browser-clients), [audit guide](../docs/guide/audit.md) |
| Control store conformance             | [controlStoreConformance](../src/testing/control_store_conformance.ts)                                                                                                                                             | [Custom stores](../docs/guide/custom-stores.md#run-the-conformance-suite)                                             |
