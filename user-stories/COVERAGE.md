# Capability coverage

Inventory covers package configuration and HTTP/Ace entry points, policy and identity boundaries, context freshness, Account Kit integration, operator commands, guides, examples and relevant tests. “New” means newly documented here, not newly implemented.

| Story                                                                           | Action                                                                          | Access                   | Status   | Catalogue |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------ | -------- | --------- |
| [US-SETUP-01](configure-masquerade/us-setup-01-configure-masquerade.md)         | Configure policy, authority and request wiring                                  | Application developer    | Operator | New       |
| [US-ACTOR-01](start-stop-mode/us-actor-01-start-stop-mode.md)                   | Start support mode with target, reason, duration, access and current context    | Signed-in actor          | Current  | New       |
| [US-ACTOR-02](view-effective-account/us-actor-02-view-effective-account.md)     | Read covered business routes as target while raw credentials remain actor-owned | Authorized support actor | Current  | New       |
| [US-ACTOR-03](edit-effective-account/us-actor-03-edit-effective-account.md)     | Mutate only when edit policy, route marker and target permission allow          | Support actor            | Current  | New       |
| [US-ACTOR-04](start-stop-mode/us-actor-04-stop-mode.md)                         | Stop current mode with fresh context                                            | Signed-in actor          | Current  | New       |
| [US-ACTOR-05](start-stop-mode/us-actor-05-change-mode-access.md)                | Stop and restart to change fixed mode access                                    | Signed-in actor          | Current  | New       |
| [US-ACTOR-06](start-stop-mode/us-actor-06-read-mode-status.md)                  | Read support mode status and context                                            | Signed-in actor          | Current  | New       |
| [US-CONTEXT-01](submit-context-token/us-context-01-submit-context-token.md)     | Submit unsafe request with current form/header context                          | Authenticated actor      | Current  | New       |
| [US-ACCOUNT-01](protect-native-account/us-account-01-protect-native-account.md) | Keep native account actions on raw actor identity and block while active        | Application developer    | Current  | New       |
| [US-TESTING-01](testing/us-testing-01-api-client-masquerading.md)               | Exercise support mode in API client tests                                       | Application test author  | Current  | New       |
| [US-OPS-01](inspect-active-modes/us-ops-01-inspect-active-modes.md)             | Read active modes                                                               | Masquerade operator      | Operator | New       |
| [US-OPS-02](review-routes/us-ops-02-review-routes.md)                           | Report route guard/marker coverage                                              | Application maintainer   | Operator | New       |
| [US-OPS-03](expire-retain-modes/us-ops-03-expire-retain-modes.md)               | Run one bounded scheduled cleanup pass                                          | Host operator            | Operator | New       |
| [US-OPS-04](expire-retain-modes/us-ops-04-revoke-active-modes.md)               | Stop one actor's mode or confirmed all modes                                    | Host operator            | Operator | New       |

The package exposes HTTP controls, effective auth wrappers, native authority and Lucid/memory stores, route markers, Account Kit blockers, Ace commands and a Japa API-client test plugin. Detailed public import paths are in the [API reference](../docs/reference/README.md); action and policy boundaries are linked from each story and the [role/source reference](REFERENCE.md).
