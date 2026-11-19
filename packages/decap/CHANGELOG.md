# @contentia/decap

## 0.1.0-alpha.2

### Minor Changes

- 8e449c2: Add `@contentia/decap`, a Decap CMS backend for Contentia. Register
  `createContentiaBackend()` with Decap and the admin reads and writes entries and media through
  `contentia/server/api`, with the OAuth 2.0 PKCE login and token refresh, the editorial workflow,
  the media library, change polling and advisory entry locking. It is the Laika CMS Decap backend
  ported to Contentia, built against `@laikacms/decap-cms` 4.2 or later (a peer dependency), and
  `resolveContentiaBackend()` switches the admin to `@contentia/vite-plugin`'s local JSON:API under
  `vite dev`. Media is stored below `media_folder` (`uploads/logo.png`), the layout
  `CatalogAssetsRepository` serves; set the backend's `assets_folder: ''` for a store that holds
  only media at its root.

### Patch Changes

- Package metadata: `homepage` links to each package's page on contentia.dev instead of the GitHub
  repo, and `repository` names the package's folder in the monorepo. `@contentia/cli` now ships its
  MIT license text.
- Updated dependencies [1e3c6f6]
- Updated dependencies [5ff5154]
- Updated dependencies [fafc1ad]
- Updated dependencies
  - contentia@0.1.0-alpha.2
