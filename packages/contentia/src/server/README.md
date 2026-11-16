# contentia/server

The HTTP surface for [Contentia](https://www.npmjs.com/package/contentia): a single-endpoint
JSON:API router over the `contentia` repositories and a self-contained OAuth 2.0 authorization
server, both CMS-agnostic, plus an MCP server that exposes the API to AI agents. None of them has a
React or admin-UI dependency.

```bash
pnpm add contentia
```

## Exports

| Export                    | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `contentia/server/api`    | Single-endpoint JSON:API router over the `contentia` repositories    |
| `contentia/server/oauth2` | OAuth 2.0 authorization server (PKCE, passkey, TOTP, email)          |
| `contentia/server/mcp`    | MCP server for AI agents (optional `@modelcontextprotocol/sdk` peer) |

The MCP server is documented in the [MCP Server](https://contentia.dev/guides/mcp) guide.

#### `api` options

Key options accepted by `contentiaApi(options)`:

| Option                    | Type                                                     | Required | Description                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`               | `DocumentsRepository`                                    | yes      | Document storage backend                                                                                                                                                         |
| `storage`                 | `StorageRepository`                                      | yes      | Raw file storage backend                                                                                                                                                         |
| `assets`                  | `AssetsRepository`                                       | no       | Binary asset storage; enables the `/assets` endpoint when provided                                                                                                               |
| `basePath`                | `string`                                                 | no       | URL prefix for all endpoints (e.g. `'/api'`)                                                                                                                                     |
| `authenticateAccessToken` | `(token: string) => Promise<User>`                       | yes      | Validates a Bearer access token and returns the principal's **identity**                                                                                                         |
| `authenticateApiToken`    | `(key: string) => Promise<User>`                         | no       | Validates an API key sent via `X-API-Key` or `Authorization: ApiKey` for M2M access                                                                                              |
| `authorize`               | `(ctx: AuthorizeContext) => boolean \| Promise<boolean>` | yes      | The authorization gate — decides what the authenticated principal may do. Receives the pre-parsed `ctx` (below). Return `false` to reject with `403`. Fails closed if it throws. |
| `logger`                  | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>`        | no       | Receives structured diagnostic output; forwarded to storage, documents, and assets API sub-handlers                                                                              |
| `cors`                    | `CorsOptions`                                            | no       | CORS configuration; required when the admin UI is served from a different origin than the API. Set `origins: '*'` for local dev, explicit origins list for production.           |

#### `User` type

The `authenticate*` callbacks return a `User` — the principal's **identity**, nothing more.
Authorization is a separate concern handled by `authorize` (see below), so `User` carries no
access/permission fields. The built-in identity fields are:

| Field          | Type     | Required | Description                                                                                |
| -------------- | -------- | -------- | ------------------------------------------------------------------------------------------ |
| `id`           | `string` | yes      | Unique identifier for the principal                                                        |
| `email`        | `string` | yes      | Email address                                                                              |
| `name`         | `string` | no       | Display name                                                                               |
| `passwordHash` | `string` | no       | Stored by `contentia/server/oauth2`; stripped before the user object is sent to the client |

Extend `User` with whatever identity/claim fields your `authorize` policy needs by augmenting the
module:

```ts
declare module 'contentia/server/api' {
  interface User {
    roles: string[];
    organizationId: string;
  }
}
```

#### `authorize` — the authorization gate (required)

Authentication answers _who_ the principal is; `authorize(ctx)` answers _what they may do_. Return
`true` to allow, `false` to reject with `403 Forbidden` before the request reaches any repository. A
thrown callback fails closed. There is no implicit default — you must state the policy.

`ctx` is an `AuthorizeContext` — the principal plus the request pre-parsed so a policy needn't
re-parse the URL:

```ts
interface AuthorizeContext {
  user: User; // identity from your authenticate* callback
  request: Request; // raw request, for anything the parsed fields don't cover
  method: string; // upper-cased HTTP method
  domain: 'documents' | 'storage' | 'assets' | 'session' | 'locks';
  operation: 'read' | 'create' | 'update' | 'delete' | 'publish' | 'unpublish';
  collection?: string; // first path segment after the domain (the API resource)
  itemId?: string; // item key/slug, URL-decoded, when present
}
```

```ts
// Allow everything authenticated:
authorize: () => true,

// Read-only — allow reads, reject anything that mutates:
authorize: ctx => ctx.operation === 'read',

// Role-based (with `interface User { roles: string[] }` augmented in):
authorize: ctx =>
  ctx.operation === 'read' ? true : ctx.user.roles.includes('editor'),
```

"Scopes" and "roles" are just identity fields you attach to the `User` and check here — the API
imposes no fixed permission vocabulary. Map `ctx.domain`/`ctx.collection`/`ctx.operation` to your
own permissions; reach for `ctx.request` only for what the parsed fields don't cover.

#### `api` return value

`contentiaApi(options)` returns a `ContentiaApi` object:

| Method                                                             | Description                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetch(request: Request): Promise<Response>`                       | Main catch-all handler — route all API traffic here                                                                                                                                                                            |
| `authenticateRequest(request: Request): Promise<Response \| User>` | Validates the request's auth (Bearer or API key) and returns a `User` on success, or a `Response` (401/403) on failure. Use in SSR route handlers to protect pages or inject the current user without routing through the API. |

#### Advisory entry locking

When two editors open the same entry, an admin that polls `/locks` (Decap does) can show a _"being
edited by X"_ banner. This is an **advisory** signal only — it never blocks a write; it just warns
before someone clobbers a concurrent edit.

The `/locks` endpoint is **auto-enabled** when the `documents` repository implements the lock
methods (`acquireLock`, `releaseLock`, `getLock`, `refreshLock`). No separate store or option is
needed:

```ts
import { contentiaApi } from 'contentia/server/api';

const api = contentiaApi({
  documents, // if documents supports locks, /locks is mounted automatically
  storage,
  authenticate*, authorize,
});
```

- **Automatic.** When the repository signals no lock capability, the `/locks` endpoint responds
  `501 Not Implemented`; the admin silently degrades to "locking unsupported" (no banner, no
  errors).
- **Owner identity is the authenticated principal's** (`user.email`), derived server-side — never
  trusted from the request body — so a caller can't release or override someone else's lock.
- **Atomic by the repository.** Lock arbitration is delegated to the `DocumentsRepository`, where
  each backend uses its datasource's native conditional write rather than a read-check-write seam.

### i18n

Login-page i18n bundles are exposed per-module: `contentia/server/oauth2/i18n`, `…/oauth2/i18n/en`,
`…/oauth2/i18n/nl`.

## Companion packages

- [`@contentia/aws`](https://www.npmjs.com/package/@contentia/aws) — AWS implementations

## Documentation

See the [contentia repository](https://github.com/contentia-dev/contentia) for setup and integration
guides.

## License

MIT
