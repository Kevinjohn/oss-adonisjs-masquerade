# Decisions

## Departures

1. **Rule departure — PKG-7.** Owner policy: `@kevinjohn/*` dependencies and peers pin the exact first-party version they support and document it. The optional Account Kit peer supports exactly `0.8.0`, recorded in `package.json`, [the integration guide](docs/guide/account-kit.md) and `README-AGENTS.md`. Third-party peers retain caret ranges and their supported floors. This policy is permanent; #495's proposed removal of the pin is superseded.
