# Starter templates

Six curated starters live in
[`starters/`](https://github.com/contentia-dev/contentia/blob/develop/starters/README.md) in this
repo. The canonical way to create a new project is through the wizard — **never copy a folder
directly**:

```bash
npx @contentia/cli create
```

The wizard selects the starter, then asks which CMS backends, widgets, and locales to install and
generates `src/cms.ts` from that selection. Flags `--starter`, `--backends`, `--widgets`,
`--locales`, and `--yes` (accept defaults) make it scriptable.

## The six starters

| Starter                                                                                                               | Demonstrates                                              |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`starter-vite-react-blog`](https://github.com/contentia-dev/contentia/tree/develop/starters/starter-vite-react-blog) | Server — SSR with bare Express + React, no meta-framework |
| [`starter-hono-blog`](https://github.com/contentia-dev/contentia/tree/develop/starters/starter-hono-blog)             | Secure-by-default `decap-api` proxy (server, default)     |
| [`starter-workers-blog`](https://github.com/contentia-dev/contentia/tree/develop/starters/starter-workers-blog)       | Runtime-agnostic Cloudflare edge deploy                   |
| [`starter-astro-blog`](https://github.com/contentia-dev/contentia/tree/develop/starters/starter-astro-blog)           | Build-time via `@contentia/astro` Content Layer           |
| [`starter-github-blog`](https://github.com/contentia-dev/contentia/tree/develop/starters/starter-github-blog)         | DB-free, git-backed collections                           |
| [`starter-opfs-blog`](https://github.com/contentia-dev/contentia/tree/develop/starters/starter-opfs-blog)             | Serverless in-browser storage via OPFS / `storage/web-fs` |

See
[`starters/README.md`](https://github.com/contentia-dev/contentia/blob/develop/starters/README.md)
for full status notes, the version-sync policy, and workspace isolation details.

## Version pinning

Starters pin published `contentia` / `@contentia/*` caret ranges — never `workspace:` or `catalog:`
protocols — so a developer can install them outside this repo. The root `version` script keeps them
current automatically; CI enforces drift via `pnpm check:starters`.

## Building new apps by hand

If you prefer to wire an app without the wizard, these building blocks are the right starting point:

- `@contentia/server/api` — `contentiaApi(...)`, the Decap-compatible HTTP API. Mount `.fetch` on a
  catch-all route.
- `@laikacms/decap-cms/backends/laika` — `createLaikaBackend()`, the Decap CMS backend the admin UI
  registers to talk to that API.
- `@contentia/server/oauth2` — `contentiaOauth2(...)`, an optional PKCE OAuth2 login server.
- A `StorageRepository` for your runtime — `contentia/storage/fs` (Node), `contentia/storage/r2`
  (Workers / R2), `contentia/storage/drizzle`, `contentia/storage/webdav`, etc.

See [Getting Started](../guides/getting-started.md) and the
[Decap integration guides](../guides/decap/) for detailed wiring instructions.
