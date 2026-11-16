# API Server

[`contentiaApi`](../reference/api/contentia/server/api/functions/contentiaApi) serves your content
over HTTP from one endpoint and checks a token on every request. Start with the smallest server that
works, then add to it as you need.

## A minimal server

```typescript
// contentia.ts
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { constantTimeEqual } from 'contentia/crypto';
import { CatalogDocumentsRepository } from 'contentia/documents/catalog';
import { jsonSerializer } from 'contentia/serializers/json';
import { contentiaApi } from 'contentia/server/api';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const catalog = new ConventionCatalogProvider({ storage });
const documents = new CatalogDocumentsRepository(storage, catalog);

export const api = contentiaApi({
  storage,
  documents,
  basePath: '/api',
  authenticateAccessToken: async token => {
    const valid = await constantTimeEqual(token, process.env.CONTENTIA_TOKEN!);
    if (!valid) throw new Error('Invalid token');
    return { id: 'admin', email: 'admin@example.com' };
  },
  authorize: () => true,
});
```

- `storage` is the [repository](./getting-started#create-a-backend) from Getting Started: files in
  `./content`.
- `documents` adds drafts, publishing, and revisions on top of those files. The catalog says which
  collections exist; by default a collection named `posts` is the folder `posts`.
- `authenticateAccessToken` decides **who** the caller is. Here, whoever sends the one shared token
  is `admin`. [Authentication](#authentication) swaps this for real users.
- `authorize` decides **what** they may do. `() => true` allows everything;
  [Authorization](#authorization) covers read-only access, roles, and scopes.

`api.fetch` is a Fetch handler, `(request: Request) => Promise<Response>`, so it runs on Node.js,
Bun, Deno, Cloudflare Workers, or inside any framework that speaks the Fetch API.

## Mount the API

Pick your framework with the icons above any example: this page, like every example in these docs,
then shows only yours, and the docs remember the pick.

Send every request under `basePath` to `api.fetch`, with the full path and an unread body. A
`buildJsonApi` handler from Getting Started mounts the same way.

::: fw node

With no framework, the handler is the server. Serve it with `@hono/node-server`:

```ts
// server.ts
import { serve } from '@hono/node-server';
import { api } from './contentia.js';

serve({ fetch: api.fetch, port: 3000 });
```

:::

::: fw bun

With no framework, the handler is the server:

```ts
// server.ts
import { api } from './contentia.js';

Bun.serve({ fetch: api.fetch, port: 3000 });
```

:::

::: fw deno

With no framework, the handler is the server:

```ts
// server.ts
import { api } from './contentia.js';

Deno.serve({ port: 3000 }, api.fetch);
```

:::

::: fw workers

Workers have no filesystem, so store content in R2 or another backend that runs on the edge (see
[Adapters](../adapters/)). The bucket and the token come from the Worker's bindings, so build the
API from `env`:

```ts
// src/contentia.ts
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { constantTimeEqual } from 'contentia/crypto';
import { CatalogDocumentsRepository } from 'contentia/documents/catalog';
import { jsonSerializer } from 'contentia/serializers/json';
import { contentiaApi } from 'contentia/server/api';
import { R2StorageRepository } from 'contentia/storage/r2';

export function createApi(env: Env) {
  const storage = new R2StorageRepository(env.CONTENT, { json: jsonSerializer }, 'json');
  const catalog = new ConventionCatalogProvider({ storage });
  const documents = new CatalogDocumentsRepository(storage, catalog);
  return contentiaApi({
    storage,
    documents,
    basePath: '/api',
    authenticateAccessToken: async token => {
      const valid = await constantTimeEqual(token, env.CONTENTIA_TOKEN);
      if (!valid) throw new Error('Invalid token');
      return { id: 'admin', email: 'admin@example.com' };
    },
    authorize: () => true,
  });
}
```

```ts
// src/index.ts
import { createApi } from './contentia.js';

export default {
  fetch: (request, env) => createApi(env).fetch(request),
} satisfies ExportedHandler<Env>;
```

```toml
# wrangler.toml
[[r2_buckets]]
binding = "CONTENT"
bucket_name = "content"
```

Set the token with `wrangler secret put CONTENTIA_TOKEN`, and in `.dev.vars` for `wrangler dev`.

:::

::: fw hono

Hono hands you the Web `Request` as `c.req.raw`:

```ts
// src/index.ts
import { Hono } from 'hono';
import { api } from './contentia.js';

const app = new Hono();
app.all('/api/*', c => api.fetch(c.req.raw));

export default app;
```

`export default app` is all Bun, Deno and Cloudflare Workers need. On Node.js, serve it with
`serve({ fetch: app.fetch, port: 3000 })` from `@hono/node-server`.

:::

::: fw express

Express hands you Node's `req` and `res`, not a Web `Request`. `getRequestListener` from
`@hono/node-server` converts between the two:

```ts
// src/server.ts
import { getRequestListener } from '@hono/node-server';
import express from 'express';
import { api } from './contentia.js';

const app = express();

// Before any body parser: the handler reads the request body itself.
app.all('/api/{*path}', getRequestListener(api.fetch));

app.use(express.json()); // for your own routes
app.listen(3000);
```

Two things break this:

- **A body parser registered first.** `express.json()` above the Contentia route reads the body
  before Contentia can, and writes fail with a `500`.
- **`app.use('/api', …)`.** It strips `/api` from the URL, so nothing matches `basePath`. Use
  `app.all` with the full path.

Express 4 writes the wildcard as `/api/*`.

:::

::: fw fastify

Fastify keeps Node's request and reply underneath as `request.raw` and `reply.raw`.
`getRequestListener` from `@hono/node-server` turns `api.fetch` into a listener for those:

```ts
// src/server.ts
import { getRequestListener } from '@hono/node-server';
import Fastify from 'fastify';
import { api } from './contentia.js';

const app = Fastify();

// A plugin scope, so switching off body parsing only affects Contentia's routes.
await app.register(async scope => {
  scope.removeAllContentTypeParsers();
  scope.addContentTypeParser('*', (_request, _payload, done) => done(null));

  const listener = getRequestListener(api.fetch);
  scope.all('/api/*', (request, reply) => {
    reply.hijack(); // the listener writes the response
    return listener(request.raw, reply.raw);
  });
});

await app.listen({ port: 3000 });
```

Fastify parses JSON bodies before your handler runs, which would leave Contentia an empty stream.
Inside the plugin scope every content type is accepted unparsed; your other routes keep Fastify's
parsers.

:::

::: fw nextjs

App Router route handlers receive a Web `Request`:

```ts
// app/api/[...path]/route.ts
import { api } from '@/lib/contentia';

const handler = (request: Request) => api.fetch(request);

export {
  handler as DELETE,
  handler as GET,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
```

Route handlers run on the Node.js runtime by default, which `FileSystemStorageRepository` needs.
Only switch a route to `runtime = 'edge'` when its storage runs on the edge too.

:::

::: fw sveltekit

`+server.ts` endpoints receive a Web `Request`. Keep the module that creates `api` under
`src/lib/server/`, so SvelteKit never ships it to the browser:

```ts
// src/routes/api/[...path]/+server.ts
import { api } from '$lib/server/contentia';
import type { RequestHandler } from './$types';

export const fallback: RequestHandler = ({ request }) => api.fetch(request);
```

`fallback` handles every HTTP method. Read secrets for the repositories and the server from
`$env/dynamic/private`; SvelteKit does not fill `process.env` from `.env` in dev.

:::

::: fw nuxt

`toWebRequest(event)` turns the h3 event into a Web `Request`, and a returned `Response` is sent as
is:

```ts
// server/api/[...path].ts
import { api } from '~~/server/contentia';

export default defineEventHandler(event => api.fetch(toWebRequest(event)));
```

:::

::: fw astro

Astro endpoints receive a Web `Request`. Endpoints that run on request need an
[adapter](https://docs.astro.build/en/guides/on-demand-rendering/):

```ts
// src/pages/api/[...path].ts
import type { APIRoute } from 'astro';
import { api } from '../../lib/contentia';

export const prerender = false;
export const ALL: APIRoute = ({ request }) => api.fetch(request);
```

To read content in your pages, use [`@contentia/astro`](./astro) instead: it plugs Contentia into
Astro's Content Layer.

:::

::: fw vitepress

A VitePress site is static once built, so Contentia runs in its dev server only, for editing content
locally. The Vite plugin's [local mode](./vite#local-mode) already serves the JSON:API there with
nothing to wire. To run your own `api` instead, add a Vite plugin with `getRequestListener` from
`@hono/node-server`:

```ts
// .vitepress/config.mts
import { getRequestListener } from '@hono/node-server';
import { defineConfig } from 'vitepress';
import { api } from '../src/contentia.js';

const listener = getRequestListener(api.fetch);

export default defineConfig({
  vite: {
    plugins: [{
      name: 'contentia-api',
      configureServer(server) {
        // No mount path: `use('/api', …)` would strip '/api' from the URL.
        server.middlewares.use((req, res, next) =>
          req.url?.startsWith('/api/') ? listener(req, res) : next()
        );
      },
    }],
  },
});
```

Point `FileSystemStorageRepository` at the folder VitePress renders, and pages written through the
API are the pages VitePress serves.

:::

::: fw docusaurus

A Docusaurus site is static once built, so Contentia runs in its dev server only, for editing
content locally. Mount `api` there with a plugin and `getRequestListener` from `@hono/node-server`:

```ts
// src/plugins/contentia.ts
import type { Plugin } from '@docusaurus/types';
import { getRequestListener } from '@hono/node-server';
import { api } from '../contentia.js';

export default function contentiaPlugin(): Plugin {
  const listener = getRequestListener(api.fetch);
  return {
    name: 'contentia-api',
    configureWebpack(_config, isServer) {
      if (isServer) return {};
      return {
        devServer: {
          // webpack-dev-server's types are not a direct dependency, hence the `any`.
          setupMiddlewares(middlewares: unknown[], devServer: any) {
            // No mount path: `use('/api', …)` would strip '/api' from the URL.
            devServer.app.use((req: any, res: any, next: () => void) =>
              req.url?.startsWith('/api/') ? listener(req, res) : next()
            );
            return middlewares;
          },
        },
      } as object;
    },
  };
}
```

Docusaurus plugins have no `configureDevServer` hook: the dev server is configured through the
`devServer` block that `configureWebpack` returns. Register the plugin in `docusaurus.config.ts`
with `plugins: [contentiaPlugin]`.

:::

**Server-side rendering:** read content through the `documents`, `assets`, and `storage`
repositories you constructed, not through `api.fetch`. Server-internal reads skip HTTP and need no
token.

`contentiaApi` reads no environment variables itself: pass secrets and ports in from `process.env`
(or your runtime's bindings) when you construct the repositories and the server.

## Try it

Start the server with a token in `CONTENTIA_TOKEN`:

```bash
export CONTENTIA_TOKEN=$(openssl rand -base64 32)
```

Create a post, then read it back:

```bash
curl -H "Authorization: Bearer $CONTENTIA_TOKEN" http://localhost:3000/api/documents/published \
  --json '{"data":{"type":"published","id":"posts/hello","attributes":{"content":{"title":"Hello"}}}}'

curl -H "Authorization: Bearer $CONTENTIA_TOKEN" http://localhost:3000/api/documents/published/posts%2Fhello
```

On the filesystem, the post is now `content/posts/hello.json`. Keys that contain `/` are
percent-encoded in URLs, hence `posts%2Fhello`. Without the token, both requests get `401`. The
[Documents API](../reference/json-api/documents) reference lists every route.

`GET /api/health` needs no token, so it doubles as a load balancer health check.

## Add assets

To serve images and other binary files at `/api/assets`, pass an assets repository over the same
storage and catalog:

```ts
import { CatalogAssetsRepository } from 'contentia/assets/catalog';

const assets = new CatalogAssetsRepository(storage, catalog);

export const api = contentiaApi({
  // …the options above, plus:
  assets,
});
```

## Where collections come from

The documents and assets repositories ask a **catalog provider** which collections exist, which
folder each one lives in, and where media goes. Two ship with Contentia:

| Provider                                                                                                       | Import                         | Collections come from                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ConventionCatalogProvider`](../reference/api/contentia/catalog-convention/classes/ConventionCatalogProvider) | `contentia/catalog-convention` | Convention: a collection named `posts` is the folder `posts`. Nothing to seed; settings you change are saved under `.contentia/`.                                |
| [`DecapCatalogProvider`](../reference/api/contentia/catalog-decap/classes/DecapCatalogProvider)                | `contentia/catalog-decap`      | A Decap CMS config object stored in storage, so the server and a Decap admin share one source of truth. Supports multi-folder and nested collections. Read-only. |

`ConventionCatalogProvider` is the right default. Reach for `DecapCatalogProvider` when a Decap
config already describes your content.

## Authentication

`authenticateAccessToken` establishes **who** the caller is: it receives the Bearer token from the
`Authorization` header and returns the caller's
[`User`](../reference/api/contentia/server/api/interfaces/User). Throw to reject the token.

The minimal server gives everyone the same token. To give each person their own, look the token up
in your session store and return that person:

```ts
export const api = contentiaApi({
  // …
  authenticateAccessToken: async token => {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    return db.users.findById(session.userId);
  },
});
```

`db` stands in for your own database. The [login server](#add-the-login-server) below issues
sessions it can look up.

### API keys

For server-to-server or CI/CD integrations that cannot perform an OAuth2 browser flow, enable API
key authentication with the optional `authenticateApiToken` option. When present, any request that
supplies a key via **either** of the two accepted header formats is routed through this callback
instead of `authenticateAccessToken`:

| Header format                 | Example                                |
| ----------------------------- | -------------------------------------- |
| `X-API-Key: <key>`            | `X-API-Key: sk-live-abc123`            |
| `Authorization: ApiKey <key>` | `Authorization: ApiKey sk-live-abc123` |

A key passed as an `api_key` query-string parameter is rejected: keys in URLs leak through server
logs, CDN logs, and browser history.

```ts
export const api = contentiaApi({
  // …the options above, plus:
  authenticateApiToken: async key => {
    const apiKey = await db.apiKeys.findByKey(key);
    if (!apiKey) throw new Error('Invalid API key');
    return db.users.findById(apiKey.userId);
  },
});
```

If `authenticateApiToken` is not configured and a request arrives with `X-API-Key` or
`Authorization: ApiKey`, the server returns `401`.

### Personal access tokens

When you issue Personal Access Tokens (PATs) as well as session tokens, use
[`resolveBearer`](../reference/api/contentia/auth/functions/resolveBearer) from `contentia/auth` as
the single seam in `authenticateAccessToken`. It detects a `lk_pat_…` prefix, looks up the PAT
record by hash, checks revocation and expiry, and falls back to your session verifier for all other
bearers. It returns a unified
[`AuthContext`](../reference/api/contentia/auth/interfaces/AuthContext) with the principal and their
granted scopes:

```ts
import { resolveBearer } from 'contentia/auth';

authenticateAccessToken: async token => {
  const ctx = await resolveBearer(token, {
    verifySessionToken: async bearer => {
      const session = await db.sessions.findByAccessToken(bearer);
      if (!session) return null;
      return { user: { id: session.userId, email: session.email }, scopes: session.scopes };
    },
    lookupPatByHash: hash => db.pats.findByHash(hash),
    onPatUsed: record => db.pats.bumpLastUsedAt(record.id), // optional
  });
  if (!ctx) throw new Error('Invalid or expired token');
  // Attach the resolved scopes so createScopePolicy() (or your own authorize) can read them.
  return { id: ctx.user.id, scopes: ctx.scopes };
},
```

`resolveBearer` returns `null` for any invalid, revoked, or expired credential and never throws on
bad input: throw from `authenticateAccessToken` yourself.

## Authorization

The required `authorize(ctx)` callback decides **what** the authenticated caller may do. Return
`true` to allow the request, or `false` to reject it with `403 Forbidden` before it reaches any
repository. A callback that throws counts as a denial. There is no implicit default: you must state
the policy.

`ctx` carries the principal plus the request pre-parsed, so a policy can decide without re-parsing
the URL:

```ts
interface AuthorizeContext {
  user: User; // the identity from your authenticate* callback
  request: Request; // the raw request, for anything the fields below don't cover
  method: string; // upper-cased HTTP method
  domain: 'documents' | 'storage' | 'assets' | 'session' | 'locks'; // 'locks' = advisory-locking sub-API
  operation: 'read' | 'create' | 'update' | 'delete' | 'publish' | 'unpublish';
  collection?: string; // first path segment after the domain (the API resource)
  itemId?: string; // the item key/slug (URL-decoded), when present
}
```

```ts
// Allow everything authenticated:
authorize: () => true,

// Read-only principal: allow reads, reject anything that mutates:
authorize: ctx => ctx.operation === 'read',
```

Map `ctx.domain`, `ctx.collection`, and `ctx.operation` to whatever permission vocabulary you like:
the API imposes none. Reach for `ctx.request` only for checks the parsed fields don't cover.

### Roles

"Roles" are just identity fields you attach to the `User` and check in `authorize`. Augment the
`User` interface with whatever your policy needs:

```ts
declare module 'contentia/server/api' {
  interface User {
    roles: string[];
  }
}

export const api = contentiaApi({
  // …
  authenticateAccessToken: yourValidator, // returns { id, email, roles, … }
  authorize: ctx => {
    if (ctx.operation === 'read') return true; // anyone authenticated may read
    if (ctx.operation === 'delete') return ctx.user.roles.includes('admin'); // only admins delete
    return ctx.user.roles.includes('editor'); // editors may create/update/publish
  },
});
```

Read-only API keys are the same idea: return the relevant identity from `authenticateApiToken` and
branch on it in `authorize`:

```ts
authenticateApiToken: async key => {
  const apiKey = await db.apiKeys.findByKey(key);
  if (!apiKey) throw new Error('Invalid API key');
  return { id: apiKey.userId, email: apiKey.email, roles: apiKey.readOnly ? [] : ['editor'] };
},
```

### Scopes

For fine-grained scopes rather than flat roles, `contentia/server/api` ships
[`createScopePolicy()`](../reference/api/contentia/server/api/functions/createScopePolicy): a
drop-in `authorize` factory that maps every CMS request to a required scope and checks the
principal's granted scopes. The scope vocabulary lives in `contentia/auth`:

| Scope           | Grants                                                              |
| --------------- | ------------------------------------------------------------------- |
| `content:read`  | GET requests to `/storage`, `/documents`, `/locks`                  |
| `content:write` | Mutating requests to `/storage`, `/documents`, `/locks`             |
| `media:read`    | GET requests to `/assets`                                           |
| `media:write`   | Mutating requests to `/assets`                                      |
| `config:read`   | Read access to config atoms (checked at scope level, not API level) |
| `admin` / `*`   | Implies every scope                                                 |
| `resource:*`    | Implies every action on that resource (e.g. `content:*`)            |

```ts
import { contentiaApi, createScopePolicy } from 'contentia/server/api';

export const api = contentiaApi({
  // …
  authenticateAccessToken: async token => {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    // Return a User with scopes populated from the session record.
    return { id: session.userId, email: session.email, scopes: session.scopes };
  },
  // Grant access when the principal's scopes satisfy the required scope for
  // each domain + operation. Fails closed: no scopes → denied (except /session).
  authorize: createScopePolicy(),
});
```

`createScopePolicy` accepts an optional `options` object:

| Option                                                                                 | Type                                          | Description                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`requiredScopeFor`](../reference/api/contentia/server/api/functions/requiredScopeFor) | `(ctx: AuthorizeContext) => Scope \| null`    | Override the request → required-scope mapping. Return `null` to allow unconditionally. |
| `scopesOf`                                                                             | `(ctx: AuthorizeContext) => readonly Scope[]` | How to read the principal's granted scopes. Defaults to `ctx.user.scopes ?? []`.       |

`hasScope(granted, required)` from `contentia/auth` resolves wildcards: `admin`/`*` satisfies
anything, and `resource:*` satisfies any `resource:action` on that resource. Use it directly if you
need a custom policy that still honours the wildcard semantics:

```ts
import { hasScope } from 'contentia/auth';

authorize: ctx => {
  if (ctx.operation === 'read') return true;
  return hasScope(ctx.user.scopes ?? [], 'content:write');
},
```

## Add the login server

Rather than building an OAuth2 server from scratch, use the bundled
[`contentiaOauth2`](../reference/api/contentia/server/oauth2/functions/contentiaOauth2) helper. It
is a self-contained PKCE authorization server with email/password login, optional passkey
(WebAuthn), and optional TOTP 2FA. Like the API, it is a Fetch handler.

```ts
// oauth2.ts
import { contentiaOauth2 } from 'contentia/server/oauth2';

export const oauth2 = contentiaOauth2({
  basePath: '/oauth2',
  clientId: process.env.OAUTH_CLIENT_ID!,
  // Required: allowlist of redirect URIs that may receive an authorization code.
  allowedRedirectUris: ['https://cms.example.com/admin/'],
  callbacks: {
    // Users: return { id, email, passwordHash } or null
    getUserByEmail: email => db.users.findByEmail(email),
    getUserById: id => db.users.findById(id),

    // Authorization codes (one-time use, short-lived)
    storeAuthorizationCode: code => db.authCodes.insert(code),
    getAuthorizationCode: code => db.authCodes.findByCode(code),
    deleteAuthorizationCode: code => db.authCodes.deleteByCode(code),

    // Sessions (hold both access and refresh tokens)
    createSession: session => db.sessions.insert(session),
    getSessionByAccessToken: token => db.sessions.findByAccessToken(token),
    getSessionByRefreshToken: token => db.sessions.findByRefreshToken(token),
    logoutSession: sessionId => db.sessions.deleteById(sessionId),
    logoutAll: userId => db.sessions.deleteAllForUser(userId),
  },
});
```

The API then accepts its access tokens through the same sessions: the `authenticateAccessToken` in
[Authentication](#authentication) looks them up with `db.sessions.findByAccessToken(token)`.

Mount it next to the API, under its own `basePath`:

::: fw node bun deno

Send `/oauth2/*` to the login server and everything else to the API:

```ts
const fetch = (request: Request) =>
  new URL(request.url).pathname.startsWith('/oauth2/') ? oauth2.fetch(request) : api.fetch(request);
```

:::

::: fw node

Pass it to `serve({ fetch, port: 3000 })` instead of `api.fetch`. Once you need more routes than
that, use Hono.

:::

::: fw bun

Pass it to `Bun.serve({ fetch, port: 3000 })` instead of `api.fetch`. Once you need more routes than
that, use Hono.

:::

::: fw deno

Pass it to `Deno.serve({ port: 3000 }, fetch)` instead of `api.fetch`. Once you need more routes
than that, use Hono.

:::

::: fw workers

Send `/oauth2/*` to the login server and everything else to the API:

```ts
// src/index.ts
import { createApi } from './contentia.js';
import { createOauth2 } from './oauth2.js'; // (env) => contentiaOauth2({ basePath: '/oauth2', … })

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    return pathname.startsWith('/oauth2/')
      ? createOauth2(env).fetch(request)
      : createApi(env).fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

Once you need more routes than that, use Hono: it runs on Workers as is.

:::

::: fw hono

```ts
app.all('/oauth2/*', c => oauth2.fetch(c.req.raw));
```

:::

::: fw express

```ts
// Before any body parser, like the API route.
app.all('/oauth2/{*path}', getRequestListener(oauth2.fetch));
```

:::

::: fw fastify

Add a second route inside the same plugin scope as the API:

```ts
const oauth2Listener = getRequestListener(oauth2.fetch);
scope.all('/oauth2/*', (request, reply) => {
  reply.hijack();
  return oauth2Listener(request.raw, reply.raw);
});
```

:::

::: fw nextjs

```ts
// app/oauth2/[...path]/route.ts
import { oauth2 } from '@/lib/oauth2';

const handler = (request: Request) => oauth2.fetch(request);

export { handler as GET, handler as POST };
```

:::

::: fw sveltekit

```ts
// src/routes/oauth2/[...path]/+server.ts
import { oauth2 } from '$lib/server/oauth2';
import type { RequestHandler } from './$types';

export const fallback: RequestHandler = ({ request }) => oauth2.fetch(request);
```

SvelteKit rejects form posts from other origins. A client on another origin sends its token request
as one, so allow that origin in the `csrf` option of `svelte.config.js`.

:::

::: fw nuxt

```ts
// server/routes/oauth2/[...path].ts
import { oauth2 } from '~~/server/oauth2';

export default defineEventHandler(event => oauth2.fetch(toWebRequest(event)));
```

:::

::: fw astro

```ts
// src/pages/oauth2/[...path].ts
import type { APIRoute } from 'astro';
import { oauth2 } from '../../lib/oauth2';

export const prerender = false;
export const ALL: APIRoute = ({ request }) => oauth2.fetch(request);
```

Astro rejects form posts from other origins. A client on another origin sends its token request as
one, so configure `security.checkOrigin` for it.

:::

::: fw vitepress docusaurus

The dev server is for editing content on your own machine, so it needs no login server.

:::

**Point your client at the OAuth2 server**

Any OAuth 2.0 client that does PKCE can sign in: it sends the user to `/oauth2/authorize`, exchanges
the code at `/oauth2/token` (form-encoded), and then calls the API with the access token as a Bearer
token. `clientId` and one of `allowedRedirectUris` must match what the client sends. If the client
runs on another origin than the API, add that origin to the API's `cors` option too.

**Optional extensions**

| Feature        | Option key in `contentiaOauth2(…)`   | Notes                                            |
| -------------- | ------------------------------------ | ------------------------------------------------ |
| Passkey        | `passkey: { enabled: true, … }`      | WebAuthn registration + authentication flows     |
| TOTP 2FA       | `totp: { … }`                        | TOTP enrollment and per-login verification       |
| CAPTCHA        | `captcha: { enabled: true, … }`      | Any provider (reCAPTCHA, hCaptcha, Turnstile, …) |
| Password reset | `passwordReset: { … }`               | Email-based reset link flow                      |
| i18n           | `translations: nl` (or other locale) | Import from `contentia/server/oauth2/i18n`       |

See
[`packages/contentia/src/server/oauth2/README.md`](https://github.com/contentia-dev/contentia/blob/develop/packages/contentia/src/server/oauth2/README.md)
for the full [`OAuthConfig`](../reference/api/contentia/server/oauth2/interfaces/OAuthConfig) option
reference.

## Guard your own routes

`contentiaApi(...)` returns a
[`ContentiaApi`](../reference/api/contentia/server/api/interfaces/ContentiaApi) with two methods:

```ts
interface ContentiaApi {
  fetch(request: Request): Promise<Response>;
  authenticateRequest(request: Request): Promise<Response | User>;
}
```

`authenticateRequest` runs the same Bearer and API-key checks as `fetch`, but hands you the `User`
instead of routing the request, so your own endpoints reuse the API's authentication. It reads the
`Authorization` and `X-API-Key` headers, so it guards requests that carry a token, such as `fetch`
calls from your client; a browser sends neither header when it navigates to a page.

::: fw node bun deno

Check the request before handing it to your own route:

```ts
if (new URL(request.url).pathname === '/me') {
  const result = await api.authenticateRequest(request);
  if (result instanceof Response) return result; // 401 or 403
  return Response.json({ email: result.email });
}
```

:::

::: fw workers

In the Worker's `fetch`, before routing to the API:

```ts
if (new URL(request.url).pathname === '/me') {
  const result = await createApi(env).authenticateRequest(request);
  if (result instanceof Response) return result; // 401 or 403
  return Response.json({ email: result.email });
}
```

:::

::: fw hono

```ts
app.get('/me', async c => {
  const result = await api.authenticateRequest(c.req.raw);
  if (result instanceof Response) return result; // 401 or 403
  return c.json({ email: result.email });
});
```

:::

::: fw express

`authenticateRequest` takes a Web `Request`, so build one from the incoming headers:

```ts
app.get('/me', async (req, res) => {
  const request = new Request(new URL(req.originalUrl, 'http://localhost'), {
    headers: new Headers(req.headers as Record<string, string>),
  });
  const result = await api.authenticateRequest(request);
  if (result instanceof Response) return res.sendStatus(result.status); // 401 or 403
  res.json({ email: result.email });
});
```

:::

::: fw fastify

`authenticateRequest` takes a Web `Request`, so build one from the incoming headers:

```ts
app.get('/me', async (request, reply) => {
  const result = await api.authenticateRequest(
    new Request(new URL(request.url, 'http://localhost'), {
      headers: new Headers(request.headers as Record<string, string>),
    }),
  );
  if (result instanceof Response) return reply.code(result.status).send(); // 401 or 403
  return { email: result.email };
});
```

:::

::: fw nextjs

```ts
// app/me/route.ts
import { api } from '@/lib/contentia';

export async function GET(request: Request) {
  const result = await api.authenticateRequest(request);
  if (result instanceof Response) return result; // 401 or 403
  return Response.json({ email: result.email });
}
```

:::

::: fw sveltekit

```ts
// src/routes/me/+server.ts
import { api } from '$lib/server/contentia';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const result = await api.authenticateRequest(request);
  if (result instanceof Response) return result; // 401 or 403
  return json({ email: result.email });
};
```

:::

::: fw nuxt

```ts
// server/routes/me.get.ts
import { api } from '~~/server/contentia';

export default defineEventHandler(async event => {
  const result = await api.authenticateRequest(toWebRequest(event));
  if (result instanceof Response) return result; // 401 or 403
  return { email: result.email };
});
```

:::

::: fw astro

```ts
// src/pages/me.ts
import type { APIRoute } from 'astro';
import { api } from '../lib/contentia';

export const prerender = false;
export const GET: APIRoute = async ({ request }) => {
  const result = await api.authenticateRequest(request);
  if (result instanceof Response) return result; // 401 or 403
  return Response.json({ email: result.email });
};
```

:::

::: fw vitepress docusaurus

A static site has no server routes of its own to guard.

:::

## Logging

Pass any `logger` compatible with the `Console` interface (`error`, `warn`, `info`, `debug`) to
receive structured diagnostic output. Without one, the API logs nothing.

```ts
export const api = contentiaApi({
  // …
  logger: console, // or a structured logger such as pino / winston
});
```

The logger is forwarded to the underlying `storage-api` and `documents-api` handlers, so you get one
log stream from a single option.

## All options

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

To let AI agents use the API, mount the [MCP server](./mcp) next to it.

Only need the API with no code of your own? [Server Config](../reference/server-config) runs it from
one config file with `contentia serve --config`.
