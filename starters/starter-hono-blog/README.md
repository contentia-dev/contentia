# starter-hono-blog

A blog built with **[Hono](https://hono.dev/) + Node.js + Contentia**.

Uses [`createEmbeddedContentia`](https://contentia.dev) to spin up a `FileSystemStorageRepository` + CatalogDocuments/Assets stack in a single call. Blog routes read content directly from `contentia.documents` — no extra HTTP round-trip.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000> — the blog is at `/`, the Decap admin at `/admin/`.

## Working from the monorepo

If you cloned the `contentia` repository and are running this starter in-place (not via the wizard),
the `starters/pnpm-workspace.yaml` carries `link:` overrides pointing at local builds of packages
that are ahead of npm. Build those packages first, then install and run:

```sh
# Build the linked packages (run from this directory)
pnpm -C ../.. --filter contentia --filter @contentia/server build

pnpm install
pnpm dev
```

The admin logs in automatically via **dev token auth** (no password needed in development). Change `auth: { mode: 'dev' }` in `src/contentia.ts` to add real authentication.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Build the admin bundle, then start the server with hot-reload (`tsx watch`) |
| `npm start` | Start the server without rebuilding the admin bundle |
| `npm run build` | Build the admin bundle only (for production, pre-build before deploy) |
| `npm run typecheck` | TypeScript type-check (no emit) |

## How it's wired

```
src/contentia.ts          createEmbeddedContentia — FileSystem + Catalog + Decap API
src/decap-config.ts   Decap collection definitions (shared with admin bundle)
src/index.ts          Hono server: /api/decap/* → contentia.fetch, blog routes, static files
src/admin-client.ts   Admin entry point (bundled to public/admin/bundle.js)
src/cms.ts            Decap bare-app registration (widgets, backend)
content/              Markdown post files (created by Decap admin)
content/uploads/       Media uploads (served at /uploads/* by Hono)
```

`createEmbeddedContentia` roots a `FileSystemStorageRepository` at `content/`, seeds `config.yml` from the `decapConfig` option, and returns a `fetch`-compatible handler for the Decap JSON:API + auth endpoints. Import `contentia.documents` in any route to read/write content without going through HTTP.

## Customise

- **Collections** — edit `src/decap-config.ts`. Changes apply to both the server and admin UI automatically.
- **Port** — set the `PORT` environment variable (default: `3000`).
- **Auth** — change `auth: { mode: 'token', authenticate: async token => { if (token !== process.env.ADMIN_TOKEN) throw new Error('Unauthorized'); return { id: 'admin', email: 'admin@example.com' }; } }` in `src/contentia.ts`.
- **Content directory** — change the `contentDir` option in `src/contentia.ts`.
