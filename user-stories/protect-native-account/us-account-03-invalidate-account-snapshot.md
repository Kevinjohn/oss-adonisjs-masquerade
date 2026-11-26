# US-ACCOUNT-03 — End support when an account or its permissions change

As a host policy owner, I want to invalidate a support mode when either account ceases to qualify so that an old selection cannot authorise fresh business work.

**Status:** Current under the stated integration.
**Access:** Host policy owner
**Entry:** Native or custom authority inspectAccount and active business admission.
**Documentation:** [Custom authorities](../../docs/guide/custom-authorities.md).
**Source:** [Inspection contract](../../src/types.ts), [Service](../../src/service.ts), [Stamp selector](../../src/native/stamp_from.ts).
**Coverage:** [Admission](../../tests/core_admission.spec.ts), [Failure handling](../../tests/core_failures.spec.ts), [Stamp selector tests](../../tests/stamp_from.spec.ts).

## Acceptance criteria

- Supply the current subject, incarnation, active flag and security stamp in the inspection snapshot. Native adapters may use `stampFrom` with a non-empty selection of stable fields. Core uses the inspected stamp.
- A changed stamp or incarnation in the inspected snapshot, inactive or missing account, revoked global permission, or revoked edit permission for an edit mode prevents the triggering request and clears the selection upon a successful transition. A newly authenticated actor incarnation uses a different owner key and cannot inherit the prior mode. View admission does not call canEdit.
- For the Account Kit authority, `inspectAccountAccess` receives `{ userId, requireActive: true }`; its account revision supplies the security stamp. Actor authentication separately compares the managed credential, Account Kit current account and provider IDs. Access-token integration also checks the configured ability. [Account Kit authority](../../src/account_kit/authority.ts)
- On active admission, `canMasquerade` and `canEdit` receive `{ actor, target }`, without the original request or reason; optional `canUseRequest` receives `{ actor, target, request }`. The host owns these decisions.
- An authority or policy exception returns unavailable and preserves the selection. A credential or request-local denial also prevents the request while preserving the selection. Repeated admission in one request retains its first decision.

## User flow

```mermaid
flowchart TD
    A["Change account or permission"] --> B["Attempt the next protected action"]
    B --> C{"Selection still eligible?"}
    C -->|No| D["Reject triggering work; inspect status"]
    C -->|Yes| E["Continue normal request checks"]
```

## Code flow

```mermaid
flowchart TD
    A["Authenticate actor; read owner row"] --> A2{"Active row?"}
    A2 -->|No| N["Admit actor as effective identity"]
    A2 -->|Yes| P{"Expired?"}
    P -->|Yes| X["Commit expiry; reject current request"]
    P -->|No| B["Inspect both snapshots; compare identities and stamps"]
    B --> Q{"Eligible and global policies approve?"}
    Q -->|No| C["Commit invalidation; reject current request"]
    Q -->|Yes| D["Check request-local policy"]
    D --> E{"Allowed?"}
    E -->|Yes| F["Admit target"]
    E -->|No| R["Refuse current request; preserve mode"]
    B -->|Inspection exception| U["Return unavailable; preserve mode"]
    Q -->|Global policy exception| U
    D -->|Request policy exception| U
```

**Code references:** [Admission and invalidation](../../src/service.ts#L565), [authority stamp selector](../../src/native/stamp_from.ts).
