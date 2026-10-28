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
- One-off CLI use is `npx @contentia/cli`; the core package ships no bin.
- Repository and site: `github.com/contentia-dev/contentia`, `contentia.dev`.

The Decap fork keeps its name: `@laikacms/decap-cms` and its `laika` backend id are unchanged.
