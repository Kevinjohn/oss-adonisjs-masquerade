# Decisions

## Departures

1. **Aligning — #518.** Account Kit replaced `managedRouteRegistration(router)` with the `account_kit.managed_routes` container service in Kevinjohn/oss-adonisjs-account-kit#1066 (merge `b0515f12`). The change is unreleased: the latest release, `0.9.1`, still exports `managedRouteRegistration`, and Masquerade consumes Account Kit only by release tarball. `src/account_kit/registration.ts` keeps reading `managedRouteRegistration` until an Account Kit release contains #1066; #518 then moves it to the service in the same change as the bump.
2. VOC-3. `AuditEvent`, `TransitionEvent`, `ControlOutcomeEvent`, the `masquerade_events` table name, and the `create_masquerade_events.stub` migration name use "event" for persisted audit ledger records rather than AdonisJS `app/events` classes. The names stay as they are.
