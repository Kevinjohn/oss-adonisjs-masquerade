# Security policy

## Supported versions

Only the latest 0.x release receives security fixes. Masquerade is distributed through GitHub
releases and is not published to npm.

## Reporting a vulnerability

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Kevinjohn/oss-adonisjs-masquerade/security/advisories)
or email [cve@kevinjohngallagher.com](mailto:cve@kevinjohngallagher.com). Never open a public issue.

Include the affected package version or commit, runtime and database versions, a concise
reproduction, and the impact you observed. Do not include live credentials or personal data.

## Verifying a release

The release notes include the SHA-256 digest for the attached tarball. Check a downloaded archive
against that digest before installing it:

```sh
shasum -a 256 adonisjs-masquerade-<version>.tgz
```

## Security model

The [security guide](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/guide/security.md)
describes what Masquerade protects and what remains the application's responsibility.

## Independent review

None yet.
