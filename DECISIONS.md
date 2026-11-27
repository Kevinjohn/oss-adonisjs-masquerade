# Decisions

## Departures

1. **Rule departure — PKG-7.** Owner policy: `@kevinjohn/*` dependencies and peers pin the exact first-party version they support and document it. The optional Account Kit peer supports exactly `0.8.0`, recorded in `package.json`, [the integration guide](docs/guide/account-kit.md) and `README-AGENTS.md`. Third-party peers retain caret ranges and their supported floors. This policy is permanent; #495's proposed removal of the pin is superseded.
2. **Aligning — #518.** Account Kit replaced `managedRouteRegistration(router)` with the `account_kit.managed_routes` container service in Kevinjohn/oss-adonisjs-account-kit#1066 (merge `b0515f12`). The change is unreleased: the latest release, `0.9.1`, still exports `managedRouteRegistration`, and Masquerade consumes Account Kit only by release tarball. `src/account_kit/registration.ts` keeps reading `managedRouteRegistration` until an Account Kit release contains #1066; #518 then moves it to the service in the same change as the bump.
