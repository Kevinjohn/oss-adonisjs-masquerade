# Decision gaps

The accepted actor/target, read-only default, edit access, route coverage and context contracts are recorded in [the Masquerade technical specification](../docs/maintainers/design/spec-masquerade.md) and summarised in [security](../docs/guide/security.md), [usage](../docs/guide/usage.md) and [route report](../docs/guide/route-report.md).

The host supplies the history route, ability and view in [US-AUDIT-03](audit-business-work/us-audit-03-review-transition-history.md). The package provides no mounted review screen. The React, Vue and JSON workspaces in [US-CONTEXT-03](submit-context-token/us-context-03-recover-browser-intent.md) demonstrate recovery for their own clients. A consuming application needs to verify its middleware order, policies and browser flows separately.

Review findings for issue 337 were reconciled against `origin/main` at `c93b1c2`. Corrections recorded in the catalogue: the effective access-token facade omits `currentAccessToken` only in its TypeScript type; `masquerade:routes` now identifies direct named registrations of `AccountKitAccountBlocker` on host-owned routes; wrappers still need manual review, so blocker placement there is a manual review. These are documentation corrections, not package/contract mismatches.
