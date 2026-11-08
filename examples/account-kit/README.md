# Account Kit integration fixture

This folder is not a standalone app. `pnpm test:account-kit` copies `examples/native-session`,
installs Masquerade and the pinned Account Kit `0.3.2` release, lays these files over the copy, and
wires the Account Kit provider and active-mode blocker with `bin/helpers/account_kit_host_wiring.ts`.
The result runs Account Kit's session and access-token strategies, with and without session
management, on SQLite and PostgreSQL.

To see the integration running, use the [Account Kit demo](../account-kit-demo/README.md) instead.
To add Account Kit to your app, follow the
[Account Kit integration guide](../../docs/guide/account-kit.md).

| File                                                 | Shows                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `config/masquerade.ts`                               | `accountKitAuthority` with an admission check in the policy    |
| `config/account_kit.ts`, `config/admission.ts`       | Account Kit and admission settings                             |
| `app/services/account_kit_guard.ts`                  | The managed guard shared by Account Kit and Masquerade         |
| `app/middleware/account_kit_admission_middleware.ts` | Admission gate placed before the Masquerade context middleware |
| `start/account_kit_routes.ts`                        | Account Kit's managed routes mounted under `/kit`              |
| `tests/functional/*.spec.ts`                         | Journey, eligibility, credentials, admission and route checks  |

```sh
pnpm test:account-kit --profile=latest --database=sqlite --strategy=session
```

Run it from the repository root with Node 24. See `bin/test_account_kit.ts` for every option.
