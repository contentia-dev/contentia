# Contributing

Notes for people working _on_ Contentia rather than _with_ it. If you're building an app that uses
Contentia, see the [Guides](../guides/) instead — this section is for changes to this repo.

## Orientation

Contentia is a monorepo around **one core package**:

| Package     | What it is                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `contentia` | Core domain, HTTP APIs and server, storage/document/asset implementations, serializers, utils. |

Alongside it, `packages/vite-plugin` and `packages/astro` hold the build plugins, and `apps/cli` the
CLI. `docs/` is the whole contentia.dev site, a VitePress app in the same pnpm workspace.

Each core package follows the same layered, DDD-lite structure (see
[Architecture](../concepts/architecture)):

```
api      → HTTP surface (storage-api, documents-api, ...)          depends on domain
domain   → interfaces (StorageRepository, ...), no runtime deps
impl     → concrete implementations (storage-fs, storage-r2, ...)  depends on domain
shared   → no internal dependencies (core, crypto, i18n, json-api)
```

A **domain** package (e.g. `documents`) defines an interface; an **implementation** package (e.g.
`documents-drizzle`) implements it; an **api** package (e.g. `documents-api`) exposes it over HTTP.
Use an existing triple under `packages/contentia/src` (`domain/storage`, `impl/storage-fs`,
`api/storage-api`) as the reference shape when adding a new one.

## Guide

1. [Local setup](./local-setup) — clone, install, build.
2. [Inner loop](./inner-loop) — test, lint, typecheck, dev, and where to add code.
3. [Landing a PR](./landing-a-pr) — branch naming, changesets, commit convention, CI checks.
4. [House style](./house-style) — the conventions a reviewer will hold you to.

Design decisions (ADRs, incident write-ups) are recorded internally, not on this public site.

The full contribution workflow also lives in
[CONTRIBUTING.md](https://github.com/contentia-dev/contentia/blob/develop/CONTRIBUTING.md) at the
repo root.
