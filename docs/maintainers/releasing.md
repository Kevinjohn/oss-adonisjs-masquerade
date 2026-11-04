# Releasing

1. On a branch, bump `version` in `package.json` and turn `## Unreleased` into
   `## <version> - <YYYY-MM-DD>` (add a new empty `## Unreleased` above it).
2. Update the public `README.md` install command, asset filename and release-note link to that
   exact version. Review version-bearing contributor and integration instructions in the same
   branch. When changing a pinned sibling-package archive, update its URL, version and checksum
   together; a Masquerade version bump does not select a new Account Kit release automatically.
3. Merge the PR.
4. Actions → release → Run workflow (on `main`).

Nothing else is manual. The release is a GitHub prerelease with the tarball attached; its notes
carry the install command and the SHA-256. `bash bin/release_check.sh` runs the same gate locally.
The workflow does not rewrite version-bearing documentation for you.
