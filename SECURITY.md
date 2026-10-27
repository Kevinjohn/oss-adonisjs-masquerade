# Security policy

## Supported versions

Masquerade is an unpublished early alpha for local self-testing. There is no registry release or
published version to upgrade to. Security fixes are made on the main branch; check the affected
commit when reporting a problem with a local build.

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

Masquerade has not had an independent security review yet. One is planned before the first beta,
with a reviewer from outside the project, covering:

- the effective session and access-token guards (`auth/`);
- the context token (`src/context_token.ts`) and its enforcement in `http/context_middleware.ts`;
- the admission order in `src/service.ts` against the SPEC section 6.4 transition table;
- the control store's compare-and-swap (`stores/lucid.ts`, `src/mode_transition.ts`).

Exploitable findings go through the private channels above. The rest are filed as public issues,
and this section will link the review once it is complete.
