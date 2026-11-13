# User story catalogue

Source-reviewed integration and operator journeys for Masquerade's HTTP controls, effective identity, Account Kit blocker, route report and retention command.

“Current” records source availability under the stated configuration; it does not claim that an application journey was run.

## Index

| Story                                                                                                                                 | Action                                         | Access                                                 | Status   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------ | -------- |
| [US-SETUP-01 — Configure policy, authority and request wiring](configure-masquerade/us-setup-01-configure-masquerade.md)              | Configure policy, authority and request wiring | Application developer                                  | Operator |
| [US-ACTOR-01 — Start a support mode for an eligible target](start-stop-mode/us-actor-01-start-stop-mode.md)                           | Start a support mode                           | Signed-in actor                                        | Current  |
| [US-ACTOR-02 — Read customer routes as the effective account](view-effective-account/us-actor-02-view-effective-account.md)           | Read customer routes as the effective account  | Authorized support actor                               | Current  |
| [US-ACTOR-03 — Make an allowed mutation during support](edit-effective-account/us-actor-03-edit-effective-account.md)                 | Make an allowed mutation during support        | Support actor with editable mode and target permission | Current  |
| [US-ACTOR-04 — Stop the current support mode](start-stop-mode/us-actor-04-stop-mode.md)                                               | Stop the current support mode                  | Signed-in actor                                        | Current  |
| [US-ACTOR-05 — Change the access level of a support mode](start-stop-mode/us-actor-05-change-mode-access.md)                          | Stop and restart with a selected access level  | Signed-in actor                                        | Current  |
| [US-ACTOR-06 — Read support mode status and context](start-stop-mode/us-actor-06-read-mode-status.md)                                 | Read support mode status and context           | Signed-in actor; native token ability required         | Current  |
| [US-CONTEXT-01 — Submit a request with current mode context](submit-context-token/us-context-01-submit-context-token.md)              | Submit a request with current mode context     | Authenticated actor on covered route                   | Current  |
| [US-ACCOUNT-01 — Keep native account operations on the actor account](protect-native-account/us-account-01-protect-native-account.md) | Protect native account operations              | Application developer                                  | Current  |
| [US-TESTING-01 — Exercise support mode in API client tests](testing/us-testing-01-api-client-masquerading.md)                         | Exercise support mode in API client tests      | Application test author                                | Current  |
| [US-OPS-01 — Inspect active support modes](inspect-active-modes/us-ops-01-inspect-active-modes.md)                                    | Inspect active support modes                   | Masquerade operator                                    | Operator |
| [US-OPS-02 — Review route coverage for Masquerade](review-routes/us-ops-02-review-routes.md)                                          | Review route coverage                          | Application maintainer                                 | Operator |
| [US-OPS-03 — Expire inactive modes and prune retained events](expire-retain-modes/us-ops-03-expire-retain-modes.md)                   | Expire modes and prune events                  | Host operator                                          | Operator |
| [US-OPS-04 — Revoke one or all active support modes](expire-retain-modes/us-ops-04-revoke-active-modes.md)                            | Revoke one or all active modes                 | Host operator                                          | Operator |

## Catalogue records

- [Portable story template](TEMPLATE.md)
- [Roles and source map](REFERENCE.md)
- [Capability coverage](COVERAGE.md)
- [Decision gaps](GAPS.md)
