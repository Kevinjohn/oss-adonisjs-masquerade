# Decision gaps

The accepted actor/target, read-only default, edit access, route coverage and context contracts are recorded in [the Masquerade technical specification](../docs/maintainers/design/spec-masquerade.md) and summarized in [security](../docs/guide/security.md), [usage](../docs/guide/usage.md) and [route report](../docs/guide/route-report.md).

No source-backed mismatch between those accepted contracts and current package behavior was identified during this catalogue pass. The examples distinguish raw actor account operations from effective target business routes, and distinguish API context headers from browser form fields. Host-specific permissions and business decisions remain owned by the application; no additional target journey is inferred here.
