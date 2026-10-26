# First registry release checklist

This prepares issue #133; it does not meet release acceptance. Dispatch requires separate owner
publication authorization after all pending gates below pass.

## Decisions

- Keep imperative commits and a handwritten changelog. Release notes read the first entry and never
  rewrite it. Earlier implementation history lives in [development-history.md](development-history.md).
- Publish the first prerelease under `alpha`, never `latest`. The manual workflow accepts an explicit
  version such as `0.1.0-alpha.1`, only from `main`. The manifest stays `0.0.0` until release.
- Keep TypeScript as an optional peer to record the tested declaration-consumer compiler contract
  (`^5.9.3 || ^6.0.3`), not a runtime requirement. JavaScript consumers need no compiler. The packed
  consumer harness reads this range to verify declarations at the 5.9.3 floor and latest matching
  compiler; TypeScript remains a development dependency for the package build.
- Keep Account Kit's exact `0.1.1` peer and GitHub artifact pin. Its registry lookup returned 404;
  the newer GitHub release does not establish a registry range. Select and verify a compatible
  range once registry distribution exists, before publishing Masquerade.

## Pending gates

- [ ] Merge the local alpha baseline (#66, PR #163), review its evidence and create the agreed
      alpha-1 baseline tag under separate owner authorization. Neither is complete here.
- [ ] Confirm ownership and availability of `adonisjs-masquerade`. Trusted publisher setup needs an
      existing package; arrange an explicitly authorized initial-publication bootstrap if needed.
- [ ] Resolve Account Kit registry availability, choose its peer range and rerun its packed matrix.
- [ ] Configure the registry trusted publisher: owner `Kevinjohn`, repository
      `oss-adonisjs-masquerade`, workflow `release.yml`, GitHub-hosted runner, direct publishing
      allowed. Do not configure a stored publish token. A new publisher must complete its first
      successful publish within two days or be recreated.
- [ ] Run full checks and release matrices on the final candidate. Review the artifact, notes and
      alpha version. Rename the first changelog heading to that version and commit before dispatch.
      Release-it dry runs are not a safe way to verify publication hooks.
- [ ] Under separate publication authorization, exercise tokenless publishing and provenance in the
      agreed test repository/package with its own matching publisher configuration, then authorize
      the real dispatch. Static checks do not meet #133's publication acceptance criterion.
- [ ] Verify the installed registry artifact, `alpha` dist-tag, repository/version identity and
      provenance attestation. Record workflow and registry evidence before closing #133.

No publication, baseline tag or provenance validation has occurred in this preparation PR.

## Sources

- [Trusted publishing](https://docs.npmjs.com/trusted-publishers/): OIDC permissions, exact workflow
  identity, public package/repository provenance, publisher expiry and registry setup.
- [pnpm publish](https://pnpm.io/cli/publish): native pnpm 11 publication and explicit dist-tags.
- [release-it registry configuration](https://github.com/release-it/release-it/blob/main/docs/npm.md):
  `npm: false` disables its registry plugin; the explicit pnpm hook owns publication and provenance.
