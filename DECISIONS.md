# Decisions

## Departures

1. **Aligning — #518.** Account Kit replaced `managedRouteRegistration(router)` with the `account_kit.managed_routes` container service in Kevinjohn/oss-adonisjs-account-kit#1066 (merge `b0515f12`). The change is unreleased: the latest release, `0.9.1`, still exports `managedRouteRegistration`, and Masquerade consumes Account Kit only by release tarball. `src/account_kit/registration.ts` keeps reading `managedRouteRegistration` until an Account Kit release contains #1066; #518 then moves it to the service in the same change as the bump.
