# Releasing

The three core packages (`contentia`, `@contentia/vite-plugin`, `@contentia/astro`) are
version-fixed via changesets and released together with `changeset publish`. Publishing MUST go
through pnpm (never `npm publish`): pnpm resolves `catalog:` dependency ranges into the tarball, npm
does not — `prepack` guards against this via `scripts/check-no-pnpm-catalog-deps.mjs`.
`changeset publish` is safe here: it detects pnpm from the root `packageManager` field and runs
`pnpm publish` per package. It also skips versions already on npm, so re-running it (or racing CI)
is harmless.

Releases are published from `main` by `.github/workflows/release.yml`, not from a laptop. Every
package then carries npm provenance: a signed statement, in a public log, that it was built from
that commit by that workflow. npmjs.com shows it on the package page, and users check it with
`npm audit signatures`. The workflow authenticates with npm trusted publishing, so there is no npm
token to leak.

Work lands on `develop`; promoting `develop` to `main` is what releases.

## Releasing

```sh
pnpm changeset                  # as usual, per change
pnpm changeset version          # bumps the versions and writes the changelogs
git commit -am "chore(release): version packages to 1.3.0-alpha.0"
git push origin develop
git push origin develop:main    # promote: the workflow publishes
```

On `main`, the workflow first runs the checks: format, lint, typecheck, tests and the CLI tarball
smoke test (the same ones the husky hooks run), and a gitleaks scan of everything reachable from
`main`. It publishes only if they all pass. It then builds the packages and runs `pnpm release`,
which publishes every version that isn't on npm yet (a push without a version bump publishes
nothing). Last, it pushes the `<package>@<version>` tags and creates the `v<version>` GitHub
release, a prerelease for alpha versions.

The checks run only on `main`, to keep Actions minutes down; `develop` relies on the hooks. To run
them on another branch, start the workflow by hand on it (Actions → Release → Run workflow): it runs
the checks and skips the publish. If gitleaks flags something that isn't a secret, add its
fingerprint (printed with the finding) to `.gitleaksignore`.

While `.changeset/pre.json` exists (pre mode), `changeset publish` publishes under the prerelease
dist-tag (`alpha`, likewise `beta`/`rc`), so `latest` keeps pointing at the last stable release.
Consumers install with `npm install contentia@alpha`. Enter pre mode with
`pnpm changeset pre enter alpha` and end it with `pnpm changeset pre exit` before versioning the
stable release.

`@contentia/cli` is **not** part of the changeset `fixed` group: it versions independently. Select
only it in `pnpm changeset` and release the same way; the GitHub release follows the core version.

## One-time setup

1. In the repository settings, create the environment `release` and limit its deployment branches to
   `main`.
2. npm only accepts a trusted publisher for a package that already exists, and apart from
   `contentia` none do yet. For the first release, create a granular access token on npmjs.com (read
   and write for `contentia` and the `@contentia` scope, a short expiry) and add it to the `release`
   environment as the secret `NPM_TOKEN`. That release still gets provenance.
3. After the first release, open each package on npmjs.com (Settings → Trusted publishing) and add
   GitHub Actions: organization `contentia-dev`, repository `contentia`, workflow `release.yml`,
   environment `release`. Then delete the `NPM_TOKEN` secret, revoke the token, and set publishing
   access to require two-factor authentication and disallow tokens.

## Publishing from your machine

If the workflow can't run, `pnpm release` from a clean `main` checkout publishes with your own npm
credentials, under the right dist-tag. Those versions have no provenance, and once trusted
publishing disallows tokens you'd have to allow them again first. Publishing MUST go through pnpm:
the `prepack` guard (`scripts/check-no-pnpm-catalog-deps.mjs`) runs automatically, so always use
`pnpm publish` or `changeset publish`, never `npm publish`.

## SBOM (Software Bill of Materials)

The npm packages ship without an SBOM. Each consumer's tools (Dependabot, Trivy, OSV-Scanner,
`npm sbom`) build one from their own lockfile, which covers Contentia and the dependency versions
they actually installed. An SBOM from our lockfile would only list the versions we tested with. If
an audit asks for one anyway, pnpm generates it:

```sh
pnpm --filter contentia sbom --sbom-format cyclonedx --prod > contentia.cdx.json
```
