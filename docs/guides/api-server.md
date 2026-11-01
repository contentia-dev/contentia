# API Server

[Getting Started](./getting-started#serve-it-over-http) serves one storage repository over HTTP with
[`buildJsonApi`](../reference/api/contentia/storage/api/functions/buildJsonApi). When an app needs
documents, storage, and assets behind **one** endpoint, with authentication built in, use
[`contentiaApi`](../reference/api/contentia/server/api/functions/contentiaApi).

```bash
pnpm add contentia
```

```typescript
import { CatalogAssetsRepository } from 'contentia/assets/catalog';
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { CatalogDocumentsRepository } from 'contentia/documents/catalog';
import { jsonSerializer } from 'contentia/serializers/json';
import { contentiaApi } from 'contentia/server/api';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const catalog = new ConventionCatalogProvider({ storage });
const documents = new CatalogDocumentsRepository(storage, catalog);
const assets = new CatalogAssetsRepository(storage, catalog);

const api = contentiaApi({
  documents,
  storage,
  assets,
  basePath: '/api',
  // WHO the caller is. Throw to reject the token.
  authenticateAccessToken: async token => {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    return db.users.findById(session.userId);
  },
  // WHAT they may do. Return false, or throw, to deny.
  authorize: ctx => ctx.operation === 'read',
});

export default { fetch: api.fetch };
```

Like `buildJsonApi`, `contentiaApi` returns a standard `fetch(request): Promise<Response>` handler,
so it runs on Node.js, Bun, Deno, Cloudflare Workers, or anything else that speaks the Fetch API.

## Options

| Option                    | Type                                                                                      | Required | Description                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`               | [`DocumentsRepository`](../reference/api/contentia/documents/classes/DocumentsRepository) | yes      | Document storage backend                                                                                                                                                                                       |
| `storage`                 | [`StorageRepository`](../reference/api/contentia/storage/classes/StorageRepository)       | yes      | Raw file storage backend                                                                                                                                                                                       |
| `assets`                  | [`AssetsRepository`](../reference/api/contentia/assets/classes/AssetsRepository)          | no       | Binary asset storage; enables the `/assets` endpoint when provided                                                                                                                                             |
| `basePath`                | `string`                                                                                  | no       | URL prefix for all endpoints (e.g. `'/api'`)                                                                                                                                                                   |
| `authenticateAccessToken` | `(token: string) => Promise<User>`                                                        | yes      | Validates a Bearer access token and returns the principal's **identity**                                                                                                                                       |
| `authenticateApiToken`    | `(key: string) => Promise<User>`                                                          | no       | Validates an API key sent via `X-API-Key` or `Authorization: ApiKey` for M2M access                                                                                                                            |
| `authorize`               | `(ctx: AuthorizeContext) => boolean \| Promise<boolean>`                                  | yes      | The authorization gate; return `false` to reject with `403`. Fails closed if it throws.                                                                                                                        |
| `logger`                  | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>`                                         | no       | Receives structured diagnostic output                                                                                                                                                                          |
| `locks`                   | `LockManager`                                                                             | no       | Advisory lock backend for the `/locks` sub-API (Decap "being edited by …" banner). Use `InProcessLockManager` from `contentia/locks/in-process` for single-node. When omitted, `/locks` returns `204` (no-op). |
| `cors`                    | [`CorsOptions`](../reference/api/contentia/server/api/interfaces/CorsOptions)             | no       | Required when the client is served from a different origin than the API                                                                                                                                        |

## `authorize`: the authorization gate

Authentication answers _who_ the caller is; `authorize(ctx)` answers _what they may do_. There is no
implicit default: you must state the policy, and a policy that throws counts as a denial.

```ts
// Allow everything authenticated:
authorize: () => true,

// Read-only:
authorize: ctx => ctx.operation === 'read',

// Role-based:
authorize: ctx =>
  ctx.operation === 'read' ? true : ctx.user.roles.includes('editor'),
```

`ctx` carries the `user`, the `domain` (`documents`, `storage`, `assets`, `session`, or `locks`),
the `operation` (`read`, `create`, `update`, `delete`, `publish`, `unpublish`), the `collection` and
`itemId` when present, the upper-cased HTTP `method`, and the raw `request`.

See [Authentication](./auth) for API keys, scope-based policies, personal access tokens, and a
complete OAuth2 login server.

## Where collections come from

The documents and assets repositories ask a **catalog provider** which collections exist, which
folder each one lives in, and where media goes. Two ship with Contentia:

| Provider                                                                                                       | Import                         | Collections come from                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ConventionCatalogProvider`](../reference/api/contentia/catalog-convention/classes/ConventionCatalogProvider) | `contentia/catalog-convention` | Convention: a collection named `posts` is the folder `posts`. Nothing to seed; settings you change are saved under `.contentia/`.                                |
| [`DecapCatalogProvider`](../reference/api/contentia/catalog-decap/classes/DecapCatalogProvider)                | `contentia/catalog-decap`      | A Decap CMS config object stored in storage, so the server and a Decap admin share one source of truth. Supports multi-folder and nested collections. Read-only. |

`ConventionCatalogProvider` is the right default. Reach for `DecapCatalogProvider` when a Decap
config already describes your content.

### Seeding the Decap config

`DecapCatalogProvider` reads the config from storage on **every** content request. Until it is
there, every document and asset operation fails with
`Decap config object not found at storage key 'config'`. Write it once, from a setup script, a
migration, or a first-boot handler:

```ts
import { DecapCatalogProvider } from 'contentia/catalog-decap';
import { runTask } from 'contentia/compat';

const catalog = new DecapCatalogProvider({ storage, configKey: 'config' });

await runTask(
  storage.createOrUpdateObject({
    key: 'config', // must match configKey
    content: {
      media_folder: 'uploads', // storage folder uploaded assets are written to
      public_folder: '/uploads', // URL prefix content uses to reference an asset
      collections: [
        {
          name: 'posts',
          label: 'Posts',
          folder: 'posts', // storage folder the documents live in
          create: true,
          fields: [{ name: 'title', widget: 'string' }, { name: 'body', widget: 'markdown' }],
        },
      ],
    },
  }),
);
```

The config is structured data, so the storage needs a serializer that round-trips objects:
[`jsonSerializer`](../reference/api/contentia/serializers/json/variables/jsonSerializer),
[`yamlSerializer`](../reference/api/contentia/serializers/yaml/variables/yamlSerializer), or
[`markdownSerializer`](../reference/api/contentia/serializers/markdown/variables/markdownSerializer).
[`rawSerializer`](../reference/api/contentia/serializers/raw/variables/rawSerializer) keeps only a
`body` string, so a config seeded through it is silently empty.

A Decap admin keeps its own copy of the config in the browser. Build both from one shared constant
so the admin and the API agree on the collections.

## Running it

`api.fetch` is a standard Fetch handler. Mount it on a catch-all route in your framework (see
[Framework setup](./frameworks) for Express, Next.js, SvelteKit, Nuxt, AdonisJS, and more), or give
it its own process.

**Node.js**, with [`@hono/node-server`](https://github.com/honojs/node-server):

```typescript
import { serve } from '@hono/node-server';

serve({ fetch: api.fetch, port: 3000 });
```

```bash
curl http://localhost:3000/api/health
```

`GET <basePath>/health` needs no credentials, so it doubles as a load balancer health check.

**Cloudflare Workers** and other edge runtimes: build the same handler over an edge-compatible
storage repository. `FileSystemStorageRepository` needs `node:fs`, so it runs on Node.js, Bun, and
Deno 2, but not in V8 isolates.

```typescript
import { R2StorageRepository } from 'contentia/storage/r2';

export default {
  fetch(request: Request, env: Env) {
    const storage = new R2StorageRepository(env.CONTENT, { json: jsonSerializer }, 'json');
    const catalog = new ConventionCatalogProvider({ storage });
    return contentiaApi({
      documents: new CatalogDocumentsRepository(storage, catalog),
      storage,
      assets: new CatalogAssetsRepository(storage, catalog),
      basePath: '/api',
      authenticateAccessToken,
      authorize,
    }).fetch(request);
  },
};
```

[Adapters](../adapters/) lists which runtimes each backend supports.

**Server-side rendering:** read content through the `documents`, `assets`, and `storage`
repositories you constructed, not through `api.fetch`. Server-internal reads skip HTTP and need no
token.

### Deploying a filesystem-backed server

`FileSystemStorageRepository` writes to its root directory, so in production that directory needs a
**persistent volume**, or content disappears on the next restart or redeploy. Any host that can
attach one works (Railway, Fly.io, a VM, Kubernetes). With Docker:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Content lives in /app/content: mount a volume here in production.
VOLUME ["/app/content"]

EXPOSE 3000
CMD ["node", "server.mjs"]
```

```bash
docker build -t contentia-api .
docker run -p 3000:3000 -v "$(pwd)/content:/app/content" contentia-api
```

`contentiaApi` reads no environment variables itself: pass secrets and ports in from `process.env`
(or your runtime's bindings) when you construct the repositories and the server.

Only need the API with no code of your own? [Server Config](./server-config) runs it from one config
file with `contentia serve --config`.
