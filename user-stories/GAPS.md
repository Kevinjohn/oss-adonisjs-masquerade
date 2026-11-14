# Decision gaps

The accepted actor/target, read-only default, edit access, route coverage and context contracts are recorded in [the Masquerade technical specification](../docs/maintainers/design/spec-masquerade.md) and summarized in [security](../docs/guide/security.md), [usage](../docs/guide/usage.md) and [route report](../docs/guide/route-report.md).

No source-backed mismatch between those accepted contracts and current package behavior was identified during this catalogue pass. The examples distinguish raw actor account operations from effective target business routes, and distinguish API context headers from browser form fields. Host-specific permissions and business decisions remain owned by the application; no additional target journey is inferred here.

Review findings for issue 337 were reconciled against `origin/main` at `c93b1c2`. Corrections recorded in the catalogue: the effective access-token facade omits `currentAccessToken` only in its TypeScript type; `masquerade:routes` does not detect `AccountKitAccountBlocker` on host-owned routes, so blocker placement there is a manual review. These are documentation corrections, not package/contract mismatches.
