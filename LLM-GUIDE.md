# Contentia for LLMs and Agents

A condensed entry point for anyone (LLM or human) bootstrapping with Contentia in under five
minutes. If you're a coding agent dropped into a repo that wants to use Contentia, **read this
first**, then the specific docs you need.

---

## 1. The two-minute mental model

Contentia is **three things stacked**:

```
┌─────────────────────────────────────────────────────────┐
│   HTTP API   (JSON:API)  — what your UI / clients call  │
│   ─ buildJsonApi / contentiaApi — web-standard fetch        │
├─────────────────────────────────────────────────────────┤
│   Domain      — what your server code calls             │
│   ─ Storage / Documents / Assets / Catalog repos    │
├─────────────────────────────────────────────────────────┤
│   Storage backend (you choose ONE)                      │
│   ─ FileSystem (Node)   ─ R2 (Workers)                  │
│   ─ Drizzle (SQL)       ─ GitHub                        │
└─────────────────────────────────────────────────────────┘
```

You pick a **storage backend**, wrap it in **repos**, expose them through the **HTTP API**, and
mount the resulting `(Request) => Promise<Response>` handler in your framework.

`contentia/server` gives you the primitives for each layer:

- **`contentiaApi(...)`** (`contentia/server/api`) — the HTTP API over your repos. Returns
  `{ fetch, authenticateRequest }`; mount `.fetch` on a catch-all route.
- **`contentiaOauth2(...)`** (`contentia/server/oauth2`) — an optional PKCE OAuth2 server for
  production login.

Contentia has no admin UI. Bring your own, or point an existing admin that speaks JSON:API at
`contentiaApi`; setting up the admin itself is outside this repo.

For most apps: construct a `StorageRepository`, wrap it in the Catalog document/asset repos, pass
them to `contentiaApi(...)`, and mount `.fetch` on a catch-all route.

---

## 2. Five tasks with code

### a) Spin up a Node.js backend (Express/Hono/Fastify/Koa/Bun/Deno)

```ts
import { CatalogAssetsRepository } from 'contentia/assets-catalog';
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { CatalogDocumentsRepository } from 'contentia/documents-catalog';
import { contentiaApi } from 'contentia/server/api';
import { FileSystemStorageRepository } from 'contentia/storage-fs';
import { markdownSerializer } from 'contentia/storage-serializers-markdown';
import { resolve } from 'node:path';

const storage = new FileSystemStorageRepository(
  resolve(process.cwd(), 'content'),
  { md: markdownSerializer },
  'md',
);
// Collections map to same-name folders; nothing to seed. For a Decap config, see the callout below.
const catalog = new ConventionCatalogProvider({ storage });
const documents = new CatalogDocumentsRepository(storage, catalog);
const assets = new CatalogAssetsRepository(storage, catalog);

const contentia = contentiaApi({
  documents,
  storage,
  assets,
  basePath: '/api',
  authenticateAccessToken: yourValidator, // throw to reject; see task (e) for production auth
  authorize: () => true, // allow every authenticated principal; tighten in production (see task e)
});

// Mount on every method at /api/*:
app.all('/api/*', c => contentia.fetch(c.req.raw));
```

> **Collections described by a Decap config?** Use
> `new DecapCatalogProvider({ storage, configKey: 'config' })` (`contentia/catalog-decap`) instead,
> and seed the config into storage once. It reads the Decap config object from `storage[configKey]`
> on every request. If the key is missing, every document and asset operation throws
> `"Decap config object not found at storage key 'config'"`. Run this once (setup script, migration,
> or first-boot handler):
>
> ```ts
> import { runTask } from 'contentia/compat';
>
> await runTask(
>   storage.createOrUpdateObject({
>     key: 'config', // must match the `configKey` you passed to DecapCatalogProvider
>     content: {
>       collections: [
>         {
>           name: 'posts',
>           label: 'Posts',
>           folder: 'posts',
>           create: true,
>           fields: [{ name: 'title', widget: 'string' }, { name: 'body', widget: 'markdown' }],
>         },
>       ],
>       media_folder: 'uploads',
>       public_folder: '/uploads',
>     },
>   }),
> );
> ```
>
> See
> [docs/guides/api-server.md → "Seeding the Decap config"](./docs/guides/api-server.md#seeding-the-decap-config)
> for the serializer requirements.

### b) Render content server-side in a framework page (Next/SvelteKit/Astro/Nuxt/Remix/etc.)

```ts
import { collectStream, runTask } from 'contentia/compat';
import { NotFoundError } from 'contentia/core';
// Export the `documents` repo you built in task (a) and import it directly —
// `contentiaApi(...)` returns only { fetch, authenticateRequest }, so SSR reads use the repo.
import { documents } from '~/server/contentia';

// List published posts in a folder:
const { items } = await collectStream(
  documents.listRecordSummaries({
    folder: 'posts',
    depth: 1,
    pagination: { page: 1, perPage: 100 }, // or { offset: 0, limit: 100 } — both styles work
    type: 'published',
  }),
);

// Read one published document by key:
try {
  const doc = await runTask(documents.getDocument('posts/hello-world'));
  const { title, body } = doc.content as { title?: string, body?: string };
} catch (err) {
  if (err instanceof NotFoundError) {
    /* render 404 */
  }
  throw err; // always re-throw unknown errors
}
```

### c) Deploy to Cloudflare Workers + R2

The same `contentiaApi(...)` wiring works on the edge — just swap `FileSystemStorageRepository` for
an edge-compatible repo such as `R2StorageRepository` (`node:fs` is unavailable in V8 isolates).

```ts
import { CatalogAssetsRepository } from 'contentia/assets-catalog';
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { CatalogDocumentsRepository } from 'contentia/documents-catalog';
import { contentiaApi } from 'contentia/server/api';
import { R2StorageRepository } from 'contentia/storage-r2';
import { markdownSerializer } from 'contentia/storage-serializers-markdown';
import { Hono } from 'hono';

export interface Env {
  CONTENT: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

const makeContentia = (env: Env) => {
  const storage = new R2StorageRepository(env.CONTENT, { md: markdownSerializer }, 'md');
  const catalog = new ConventionCatalogProvider({ storage });
  return contentiaApi({
    documents: new CatalogDocumentsRepository(storage, catalog),
    storage,
    assets: new CatalogAssetsRepository(storage, catalog),
    basePath: '/api',
    authenticateAccessToken: yourValidator,
    authorize: () => true, // allow every authenticated principal; tighten in production (see task e)
  });
};

app.all('/api/*', c => makeContentia(c.env).fetch(c.req.raw));

export default app;
```

### d) Use the HTTP API from a SPA (Vue/Solid/Lit/React-SPA)

**Don't.** Use a sidecar Node/Workers backend that exposes `/api/posts` etc. as public endpoints
(reading the repo directly), and have the SPA `fetch('/api/posts')`. Section 2a has the wiring for
such a backend.

Why: the Contentia HTTP API requires a Bearer token on every endpoint except `/health`. SPAs can't
safely hold one.

### e) Add real auth (production)

Pass a real `authenticateAccessToken` validator to `contentiaApi(...)`. It receives the Bearer token
on every request and must return a `User` (throw to reject — `contentiaApi` turns thrown errors into
a 401).

```ts
import { contentiaApi } from 'contentia/server/api';
import { jwtVerify, SignJWT } from 'jose';

// 1. Issue a JWT after your login form:
const token = await new SignJWT({ email: user.email, name: user.name })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(user.id)
  .setExpirationTime('8h')
  .sign(secret);

// 2. Hand that token to the client, which sends it as `Authorization: Bearer <token>`.

// 3. Validate it on every API request:
const contentia = contentiaApi({
  documents,
  storage,
  assets,
  basePath: '/api',
  async authenticateAccessToken(token) {
    const { payload } = await jwtVerify(token, secret);
    return {
      id: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
    };
  },
  authorize: () => true, // every JWT-authenticated user is an editor; restrict further if needed
});
```

For a full self-contained login server (email/password, passkey, TOTP) use the
`contentiaOauth2(...)` PKCE server from `contentia/server/oauth2` — see
[docs/guides/auth.md → "Production login with contentiaOauth2"](./docs/guides/auth.md#production-login-with-contentiaoauth2).

---

### f) Add the AI assistant

`contentia/server/ai` mounts chat and session endpoints that power an editor's AI assistant. Install
the optional peer first:

```bash
pnpm add ai @ai-sdk/anthropic   # or any other @ai-sdk/* provider
```

Then mount `decapAi` alongside your existing `contentiaApi`:

```ts
import { resolveBearer } from 'contentia/auth';
import { decapAi } from 'contentia/server/ai';
import { anthropic } from 'contentia/server/ai/providers';

const ai = decapAi({
  model: anthropic('claude-sonnet-5-5'),
  basePath: '/api/ai',
  authenticateAccessToken: async token => {
    const ctx = await resolveBearer(token, { verifySessionToken, lookupPatByHash });
    if (!ctx) throw new Error('Unauthorized');
    return { ...ctx.user, scopes: ctx.scopes };
  },
  callbacks: { createSession, getSession, getSessionsByDocument, updateSession, deleteSession },
});

// In your framework router alongside contentiaApi:
app.all('/api/ai/*', c => ai.fetch(c.req.raw));
```

The client half is a chat transport in the admin; Contentia does not ship one. The server declares
two client-side tools (`getDocumentData` / `updateDocument`) with no `execute`, so the SDK ships
them to the browser where the open editor entry lives. Add your own server-side tools via
`config.tools`.

See [docs/guides/ai-assistant.md](./docs/guides/ai-assistant.md) and the options reference in
[packages/contentia/src/server/ai/README.md](./packages/contentia/src/server/ai/README.md).

---

## 3. Choosing a storage backend

`contentiaApi(...)` is runtime-agnostic — the only thing that changes between Node and the edge is
which `StorageRepository` you construct:

| Storage repo                  | Subpath                       | Runtime                                          |
| ----------------------------- | ----------------------------- | ------------------------------------------------ |
| `FileSystemStorageRepository` | `contentia/storage-fs`        | Node, Bun, Deno (needs `node:fs`)                |
| `R2StorageRepository`         | `contentia/storage-r2`        | V8 isolates (Workers, Vercel Edge)               |
| `DrizzleStorageRepository`    | `contentia/storage-drizzle`   | Any SQL DB via Drizzle ORM                       |
| `WebDavStorageRepository`     | `contentia/storage-webdav`    | Any RFC 4918 WebDAV server                       |
| `GithubStorageRepository`     | `contentia/storage-github`    | Runtime-agnostic (`fetch`-only); GitHub repos    |
| `GitlabStorageRepository`     | `contentia/storage-gitlab`    | Runtime-agnostic (`fetch`-only); GitLab repos    |
| `BitbucketStorageRepository`  | `contentia/storage-bitbucket` | Runtime-agnostic (`fetch`-only); Bitbucket repos |

Wrap the repo in `CatalogDocumentsRepository` / `CatalogAssetsRepository`, pass them to
`contentiaApi(...)`, and mount `.fetch` from your framework's catch-all route. `contentiaApi(...)`
returns `{ fetch, authenticateRequest }`. For server-side render reads, call the `documents` /
`assets` / `storage` repos directly to **bypass HTTP auth** — server-internal reads don't need a
token.

---

## 4. Non-obvious gotchas

These are the things that consistently bite first-time integrators:

1. **The HTTP API requires auth on every endpoint except `/health`.**
   - Server-side render reads must call the repos directly (via `contentia/compat`'s `runTask` /
     `collectStream`), NOT through `contentia.fetch(internalRequest)`.

2. **Express/Fastify/Koa: do NOT mount `express.json()` / Fastify body parsers / `koa-bodyparser` in
   front of `/api/*`.**
   - The web-standard adapter streams the raw body to `contentia.fetch`. Body parsers drain it
     first.

3. **`contentia/storage-fs` is NOT a separate package on npm.**
   - It's a subpath export of `contentia`. Use
     `import { FileSystemStorageRepository } from
     'contentia/storage-fs'`. Same for
     `contentia/storage-api`, `contentia/documents-api`, `contentia/storage-serializers-*`, etc.

4. **`FileSystemStorageRepository` is Node-only.** It needs `node:fs` and a writable local
   filesystem, so it can't run in Workers/edge code. On the edge, construct an edge-compatible
   `StorageRepository` such as `R2StorageRepository` instead and pass it to the same
   `contentiaApi(...)`.

5. **Edge-compatible storage options: R2 and the git-backed repos.** `R2StorageRepository`,
   `GithubStorageRepository`, `GitlabStorageRepository`, and `BitbucketStorageRepository` are all
   valid in V8 isolates and any `fetch`-only edge runtime. Vercel Blob, Netlify Blobs, Deno KV, and
   Bun S3 don't have first-party adapters yet — for those platforms write a small
   `StorageRepository` adapter or use one of the git-backed repos:
   ```ts
   import { BitbucketStorageRepository } from 'contentia/storage-bitbucket';
   import { GithubStorageRepository } from 'contentia/storage-github';
   import { GitlabStorageRepository } from 'contentia/storage-gitlab';
   ```

6. **Admin UI wiring is not in this repo.** Serving an admin, keeping it out of your framework's
   hydration, and pointing it at the path you mounted `contentiaApi(...)` on are the admin's
   concern, not Contentia's.

7. **`workspace:*` for internal deps; `catalog:*` for shared external deps.** Use `workspace:*` for
   any `@contentia/*` package reference within the monorepo, and `catalog:*` for shared external
   dependencies defined in the root `pnpm-workspace.yaml` catalog.

8. **Register a serializer for every file type in your content folder.** The serializer registry
   maps extensions to serializers, e.g. `{ md, yaml, yml, json, raw }`. If you only register `md`,
   reading or saving YAML and JSON files fails.

9. **Effect Platform 4.x moved HTTP types into `effect/unstable/http/*`.** If you're using
   `@effect/platform-node`, import from `effect/unstable/http/HttpRouter`, not
   `@effect/platform/HttpRouter`. The platform-node package only exports the Node.js server
   primitives (`NodeHttpServer`, `NodeRuntime`). Additionally:
   - `Effect.catchAll` → use `Effect.result()` to convert failures to `Result<A, E>`, then branch on
     `Result.isSuccess` / `Result.isFailure`. The `.success` field holds the value on success.
   - `HttpRouter.add(method, path, handler)` at the **module** level returns a `Layer` (not an
     `Effect`). Compose route layers with `Layer.mergeAll` and serve via
     `HttpRouter.serve(appLayer)`.
   - Bridge `contentia.fetch` into Effect HTTP: `yield* HttpServerRequest.toWeb(request)` gives a
     WHATWG `Request`; wrap the result with `HttpServerResponse.fromWeb(response)`.

10. **Both `{ page, perPage }` and `{ offset, limit }` pagination shapes are valid.** The
    `getCapabilities()` response tells you which styles a given backend supports
    (`capabilities.pagination.styles.offset` / `.page` / `.cursor`). Most backends support both
    offset and page styles; cursor is backend-specific. Both `listRecordSummaries` and `listRecords`
    exist on `DocumentsRepository`:
    - `listRecordSummaries({ pagination: { page: 1, perPage: 100 } })` — lightweight summaries,
      prefer this for listing/index pages.
    - `listRecords({ pagination: { offset: 0, limit: 100 } })` — full record bodies with
      offset-based pagination, use when you need the complete content of every record in one pass.

11. **`NotFoundError` must be imported from `contentia/core` and re-thrown.** A bare `catch {}`
    swallows all errors. Always check:
    ```ts
    catch (err) {
      if (err instanceof NotFoundError) return c.notFound();
      throw err;
    }
    ```

12. **Packages need a `dist/` before downstream packages can type-check.** The core package is
    `contentia`. If you run `pnpm --filter <package> exec tsc --noEmit` directly and get
    `Cannot find module '@contentia/...'`, build the upstream package first:
    ```
    pnpm --filter contentia build
    ```
    The correct way to typecheck in CI or as a one-shot command is the root-level turbo task, which
    builds upstream dependencies automatically:
    ```
    pnpm run typecheck              # builds all packages, then type-checks everything
    pnpm run typecheck --filter ... # scoped to specific packages
    ```

13. **Seed the Decap config object before the first content operation.** If you use
    `DecapCatalogProvider`, it reads your Decap config from `storage[configKey]` on every request.
    On an empty storage directory the key does not exist, and every call to `documents.*` or
    `assets.*` throws `"Decap config object not found at storage key 'config'"`. Seed it once:
    ```ts
    import { runTask } from 'contentia/compat';
    await runTask(storage.createOrUpdateObject({ key: 'config', content: yourDecapConfig }));
    ```
    The serializer registry must support structured data — `markdownSerializer`, `yamlSerializer`,
    or `jsonSerializer` all work; `rawSerializer` silently drops the `collections` field. See the
    callout in task (a) above and
    [docs/guides/api-server.md → "Seeding the Decap config"](./docs/guides/api-server.md#seeding-the-decap-config).

14. **`CatalogDocumentsRepository` injects a `language` field into every stored content object.**
    The implementation co-locates the document language with its content in storage so reads can
    recover it without a separate metadata file. When i18n is not configured, Decap sends
    `language: "und"` (BCP 47 "undetermined"), so every saved `.json` file ends up with:
    ```json
    { "title": "My post", "body": "...", "language": "und" }
    ```
    This field will NOT be declared in your Decap `fields:` list — it appears alongside your data as
    a Contentia internal. Filter it out when reading content files directly for rendering:
    ```ts
    const { language: _, ...content } = doc.content; // strip before using
    ```
    If you configure i18n, the value will be the active locale rather than `"und"`.

---

## 5. Where to start

- **Minimal Node example** → [docs/guides/api-server.md](./docs/guides/api-server.md)
  (`contentiaApi` over `FileSystemStorageRepository`, served with `@hono/node-server`)
- **Minimal edge example** →
  [docs/guides/api-server.md → "Running it"](./docs/guides/api-server.md#running-it)
  (`R2StorageRepository` on Cloudflare Workers) and task 2c above
- **No server code at all** → `contentia serve --config` runs the API from one config file; see
  [docs/guides/server-config.md](./docs/guides/server-config.md)
- **Astro** → `@contentia/astro` (Content Layer loaders, dev JSON:API, live collections, Zod schema)
- **AI assistant in the editor** → mount `contentia/server/ai` (section 2f)
- **Inline wiring code** → sections 2a (Node) and 2c (Workers/R2) above have copy-paste-ready code

---

## 6. What to do when this guide is wrong

This file lives in the repo because Contentia evolves. If you (LLM or human) followed an instruction
here and it didn't work — **update this file in the same PR**.
