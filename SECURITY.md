# Security policy

## Supported versions

Masquerade is an early alpha distributed as GitHub prereleases; it is not published to a package
registry. Only the latest prerelease and the main branch receive security fixes. Name the release
tag or commit when reporting a problem.

## Reporting a vulnerability

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Kevinjohn/oss-adonisjs-masquerade/security/advisories)
or privately to [cve@kevinjohngallagher.com](mailto:cve@kevinjohngallagher.com). On GitHub, use
**Report a vulnerability** from the Security Advisories page. Do not open a public issue.

Please include the affected package version or commit, runtime and database versions, a concise
reproduction, and the impact you observed. Do not include live credentials or personal data.
For control-store concerns, include whether the affected path uses SQLite or PostgreSQL and
whether the failure occurred before or after the database commit, if known.

The maintainer will acknowledge the report, confirm the affected versions, and agree a disclosure
date with you once a fix is ready.

## Security model

[SPEC-masquerade.md](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/design/SPEC-masquerade.md) section 10 describes what Masquerade defends against and what remains
the application's responsibility.

## Independent review

Masquerade has not had an independent security review.
