---
"contentia": major
"@contentia/server": major
"@contentia/vite-plugin": major
"@contentia/astro": major
"@contentia/github": major
"@contentia/gitlab": major
"@contentia/bitbucket": major
"@contentia/cli": major
---

Rename the project from Laika to Contentia.

- npm packages: `laikacms` → `contentia`, `@laikacms/*` → `@contentia/*`, `laikacli` →
  `@contentia/cli` (bin `contentia`).
- Identifiers: every `Laika*` / `laika*` / `LAIKA_*` name is now `Contentia*` / `contentia*` /
  `CONTENTIA_*` (`LaikaTask` → `ContentiaTask`, `LaikaError` → `ContentiaError`, the `laika:` Vite
  import protocol → `contentia:`, the `.laika/` folder → `.contentia/`).
- `npx contentia` runs the CLI: the core package ships a dependency-free bin that delegates to a
  locally installed `@contentia/cli` or fetches the matching version.
- Repository and site: `github.com/contentia-dev/contentia`, `contentia.dev`.

The Decap fork keeps its name: `@laikacms/decap-cms` and its `laika` backend id are unchanged.
