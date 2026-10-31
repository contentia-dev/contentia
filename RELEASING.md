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

On `main`, the workflow builds the packages and runs `pnpm release`, which publishes every version
that isn't on npm yet (a push without a version bump publishes nothing). It then pushes the
`<package>@<version>` tags and creates the `v<version>` GitHub release, a prerelease for alpha
versions, with the SBOMs attached. Tests don't run in the workflow: the pre-push hook runs them
before anything reaches `main`.

While `.changeset/pre.json` exists (pre mode), `changeset publish` publishes under the prerelease
dist-tag (`alpha`, likewise `beta`/`rc`), so `latest` keeps pointing at the last stable release.
Consumers install with `npm install contentia@alpha`. Enter pre mode with
`pnpm changeset pre enter alpha` and end it with `pnpm changeset pre exit` before versioning the
stable release.

`@contentia/github`, `@contentia/gitlab`, `@contentia/bitbucket` and `@contentia/cli` are **not**
part of the changeset `fixed` group: they version independently. Select only them in
`pnpm changeset` and release the same way; the GitHub release follows the core version.

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

`pnpm gen-sbom` generates a CycloneDX SBOM for each published package (`contentia`,
`@contentia/vite-plugin`, `@contentia/astro`, `@contentia/github`, `@contentia/gitlab`,
`@contentia/bitbucket`) via pnpm's built-in `pnpm sbom` command — no extra dependency needed. Output
goes to `sbom/contentia.cdx.json`, `sbom/contentia-vite-plugin.cdx.json`,
`sbom/contentia-astro.cdx.json`, `sbom/contentia-github.cdx.json`, `sbom/contentia-gitlab.cdx.json`,
and `sbom/contentia-bitbucket.cdx.json` (all gitignored — regenerate, don't commit). The script is
`scripts/generate-sbom.mjs`.

`pnpm release` runs it before `changeset publish`, and the release workflow attaches the result to
the GitHub release. Run it by hand (`pnpm gen-sbom`) any time you want a fresh SBOM, e.g. for a
supply-chain audit.
