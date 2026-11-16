# Decap CMS

Edit Contentia content in the [Decap CMS](https://decapcms.org/) admin. `@contentia/decap` is a
Decap backend: instead of committing to a Git provider, the admin reads and writes entries and media
through the [Contentia API](./api-server), so it works over whichever storage the server is
configured with.

Contentia doesn't ship the admin itself. You build the admin as you would any Decap admin, and
register this backend with it.

## Install

```sh
pnpm add @contentia/decap contentia @laikacms/decap-cms react
```

The backend is built against `@laikacms/decap-cms` 4.2 or later: the Decap CMS v4 distribution that
publishes Decap's backend interface (`lib/backend`, `lib/util`) for other packages to build on.
Decap 3 (`decap-cms-app`) has a different backend interface and is not supported.

## Register the backend

Register [`createContentiaBackend()`](../reference/api/decap/functions/createContentiaBackend) under
a name, and point the config's `backend:` block at that name:

```ts
// admin/main.ts
import { createContentiaBackend } from '@contentia/decap';
import { CMS, init } from '@laikacms/decap-cms/app/bare';

CMS.registerBackend('contentia', createContentiaBackend());
// `/bare` registers nothing else: register the widgets and the JSON entry codec your
// collections use, then call init().
init();
```

```yaml
# admin/config.yml
backend:
  name: contentia
  base_url: https://api.example.com
  api_root: /api
  app_id: decap-cms

media_folder: uploads
public_folder: /uploads

collections:
  - name: posts
    label: Posts
    folder: posts
    format: json
    create: true
    fields:
      - { label: Title, name: title, widget: string }
```

Every collection needs `format: json`; see [Collection formats](#collection-formats).

## The server

The backend needs a Contentia API at `base_url` + `api_root`, and an OAuth 2.0 server for the login.
Build the API as in the [API Server](./api-server) guide, with an assets repository for the media
library and a lock manager for the "being edited by" banner:

```ts
// contentia.ts
import { R2AssetsRepository } from 'contentia/assets/r2';
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { CatalogDocumentsRepository } from 'contentia/documents/catalog';
import { InProcessLockManager } from 'contentia/locks/in-process';
import { jsonSerializer } from 'contentia/serializers/json';
import { contentiaApi } from 'contentia/server/api';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const catalog = new ConventionCatalogProvider({ storage });

export const api = contentiaApi({
  documents: new CatalogDocumentsRepository(storage, catalog),
  storage,
  assets: new R2AssetsRepository({
    bucket: env.MEDIA,
    createUrl: key => `https://media.example.com/${key}`,
  }),
  locks: new InProcessLockManager(),
  basePath: '/api',
  authenticateAccessToken,
  authorize,
  // The admin is served from another origin than the API.
  cors: { origins: ['https://cms.example.com'] },
});
```

With the convention catalog, a Decap collection with `folder: posts` is the Contentia collection
`posts`, and its entries are stored as `posts/<slug>.json`. To have the server read its collections
from the same Decap config instead, use
[`DecapCatalogProvider`](./api-server#where-collections-come-from).

For the login, mount the bundled [`contentiaOauth2`](./api-server#add-the-login-server) next to the
API, or run [Server Config](../reference/server-config#authentication) with your own provider or
test users.

The backend calls these endpoints:

| Endpoint                      | Used for                                                      |
| ----------------------------- | ------------------------------------------------------------- |
| `{api}/session`               | Resolving the signed-in user after login                      |
| `{api}/health`                | Decap's backend status check                                  |
| `{api}/documents`             | Entries, the editorial workflow and change polling            |
| `{api}/assets`                | The media library                                             |
| `{api}/locks`                 | Entry locking (optional, see [Entry locking](#entry-locking)) |
| `{base_url}/oauth2/authorize` | The PKCE login redirect                                       |
| `{base_url}/oauth2/token`     | The token exchange and the refresh grant                      |

## Config

The `backend:` block takes these keys:

| Key                                | Type       | Required           | Description                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                             | `string`   | yes                | The name the backend was registered under, `contentia` in the examples here.                                                                                                                                                                                                                                                                                                                            |
| `base_url`                         | `string`   | yes                | Origin of the Contentia server.                                                                                                                                                                                                                                                                                                                                                                         |
| `api_root`                         | `string`   | no                 | Path appended to `base_url` to form the API root (e.g. `/api`).                                                                                                                                                                                                                                                                                                                                         |
| `assets_folder`                    | `string`   | no                 | Folder in the assets repository that holds the media library. Default: `media_folder`, so an upload to `uploads/logo.png` is stored as `uploads/logo.png`. Set `''` for an assets store that holds only media, at its root. See [Media](#media).                                                                                                                                                        |
| `app_id`                           | `string`   | **yes, for OAuth** | The OAuth client ID, sent as `client_id` in the authorization redirect, the token exchange and the refresh grant. Without it (and without `dev_token`) the login page fails with `Missing required configuration: base_url and app_id are required`.                                                                                                                                                    |
| `auth_endpoint`                    | `string`   | no                 | Path (relative to `base_url`) of the authorization endpoint. Default: `oauth2/authorize`. Ignored when `use_oidc` is `true`.                                                                                                                                                                                                                                                                            |
| `auth_token_endpoint`              | `string`   | no                 | Path (relative to `base_url`) of the token endpoint, used for the token exchange and for refreshing. Default: `oauth2/token`. Ignored when `use_oidc` is `true`.                                                                                                                                                                                                                                        |
| `auth_token_endpoint_content_type` | `string`   | no                 | `Content-Type` of the token request. Default: `application/x-www-form-urlencoded; charset=utf-8`.                                                                                                                                                                                                                                                                                                       |
| `use_oidc`                         | `boolean`  | no                 | Discover the endpoints from `${base_url}/.well-known/openid-configuration` instead. Default: `false`.                                                                                                                                                                                                                                                                                                   |
| `dev_token`                        | `string`   | no                 | **Development only. Never set it in production.** A pre-shared bearer token that skips the OAuth flow: the login page logs in with it automatically, and every page load authenticates with it, ignoring any stored session. Pair it with a server that accepts the same token.                                                                                                                         |
| `acceptRoles`                      | `string[]` | no                 | Role allowlist. When non-empty, the `role` attribute `/session` returns must be one of these values, or login fails with a `403` and no session is stored. A session without a `role` is rejected. Omit it, or set `[]`, to admit any authenticated session. `/session` returns the `User` your `authenticateAccessToken` resolved, so add `role` to it by augmenting `User` in `contentia/server/api`. |

## Editing locally with Vite

The [Vite plugin's local mode](./vite#local-mode) mounts the Contentia API on the dev server, over
the same content folder the site builds from. Use
[`resolveContentiaBackend()`](../reference/api/decap/functions/resolveContentiaBackend) to point the
admin at it while `vite dev` runs, and at the remote server everywhere else:

```ts
// vite.config.ts
contentia({ dir: 'content', localApi: true });
```

```ts
// admin/main.ts
import { resolveContentiaBackend } from '@contentia/decap';
import { init } from '@laikacms/decap-cms/app/bare';

init({
  config: {
    backend: resolveContentiaBackend({
      remote: {
        name: 'contentia',
        base_url: 'https://api.example.com',
        api_root: '/api',
        app_id: 'decap-cms',
      },
    }),
    // ...the rest of your config
  },
});
```

- `import.meta.env.DEV` truthy: a backend pointing at the local API, logging in with a dummy dev
  token (local mode has no auth).
- Falsy, or `import.meta.env` not defined at all (a production build, `vite preview`, a non-Vite
  bundle): `remote`, unchanged. An admin loaded outside a Vite dev build never targets a local
  endpoint that isn't there.

Call it from the admin's TypeScript entry point, not from `config.yml`, which has no access to
`import.meta.env`. The local API has no locks, so the "being edited by" banner stays hidden.

| Option           | Type                           | Description                                                                                                     |
| ---------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `remote`         | `ContentiaBackendModuleConfig` | Required. The `backend:` block for the OAuth flow, returned as-is unless the dev flag is truthy.                |
| `local.basePath` | `string`                       | Where the local API is mounted. Default `/__contentia`. Must match `localApi.basePath` on the Vite plugin.      |
| `local.devToken` | `string`                       | The dummy token the dev login page submits. Default `contentia-local-dev`. Only has to be non-empty and stable. |
| `dev`            | `boolean`                      | Overrides `import.meta.env.DEV`. Leave it out at real call sites; it exists for tests.                          |

## Collection formats

**Only `format: json` collections are supported.** The documents API stores an entry's content as a
plain object, which only JSON entries produce. A collection without `format:` defaults to markdown
with frontmatter, so set it explicitly. Saving an entry in any other format fails in the browser,
before any request reaches the server:

```
The Contentia backend currently only supports JSON-format collections; set `format: json` on collection `posts`.
```

## Media

The media library lists, uploads and deletes through `{api}/assets`. An upload is stored under its
file name inside the assets folder, and Decap shows it under `public_folder`. The assets folder is
`media_folder` unless `assets_folder` says otherwise:

| `assets_folder`         | `uploads/logo.png` is stored as | Fits                                                                                                                                                                  |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| not set: `media_folder` | `uploads/logo.png`              | `CatalogAssetsRepository`, which the [API Server](./api-server) guide and the [Vite plugin's local mode](./vite#local-mode) use, and a bucket shared with other files |
| `''`                    | `logo.png`                      | An assets store that holds only media, at its root, such as a dedicated [R2](../adapters/r2) bucket                                                                   |
| `media`                 | `media/logo.png`                | Media in a folder of its own, whatever `media_folder` is                                                                                                              |

`CatalogAssetsRepository` reads a key's first segment as its media collection, so the default layout
is the one it serves. To point the admin at a bucket that already holds media at its root, set
`assets_folder: ''` on the remote backend only:

```ts
resolveContentiaBackend({
  remote: {
    name: 'contentia',
    base_url: 'https://api.example.com',
    api_root: '/api',
    app_id: 'decap-cms',
    assets_folder: '',
  },
});
```

The local backend keeps the default, which is what the Vite plugin's local API serves.

## Editorial workflow

With `publish_mode: editorial_workflow`, drafts are unpublished records in the documents repository,
and Decap's statuses map onto the record's `status`. Publishing publishes the record. Unpublishing
moves a live entry back to a draft with its content intact when the Decap build calls the backend's
optional `unpublishEntry`; a build that doesn't (4.2.0 included) deletes the published record
instead. Deploy previews are not supported.

## Entry locking

When two editors open the same entry, the second sees a "being edited by" banner, arbitrated by the
server rather than by one browser's local state. The backend uses `{api}/locks`, which
`contentiaApi` serves from the documents repository's lock methods or from its `locks` option.

- **The owner is never sent.** The server derives the lock owner from the authenticated user, so
  nobody can take a lock as somebody else.
- **The client holds a token.** Acquiring returns an opaque token, kept in memory per entry and sent
  on refresh and release; the server authorizes on the token. Tokens are dropped on logout. Reading
  a lock never returns one.

| Server response | Behaviour                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `423 Locked`    | Rejects, so Decap fetches the holder and shows the conflict banner.                                                |
| `204` or `501`  | The server cannot lock. Resolves `null`, hides the lock UI, and stops calling `/locks` until the page is reloaded. |
| network failure | Resolves `null`, so locking degrades instead of blocking the edit. The next call tries again.                      |

Locks are advisory: nothing blocks a write. `InProcessLockManager` keeps locks in the server
process, so editors only see each other's locks when they reach the same server. Run a single
replica if you rely on them.

## Sessions

After login the session (access token, refresh token, expiry) lives in `sessionStorage`, under
[`ACCESS_TOKEN_STORAGE_KEY`](../reference/api/decap/variables/ACCESS_TOKEN_STORAGE_KEY)
(`contentia_access_token`), `REFRESH_TOKEN_STORAGE_KEY` and `TOKEN_EXPIRES_AT_STORAGE_KEY`. The
access token is refreshed with the refresh grant shortly before it expires; the server rotates the
pair on refresh, so the backend shares one in-flight refresh between concurrent requests.

A host app that calls its own API with the admin's session should get the token from the backend's
`getToken()`, which refreshes it when needed. Read `ACCESS_TOKEN_STORAGE_KEY` only as a fallback
before the backend has authenticated: a second refresher of its own would revoke the admin's
session.

## Options

[`createContentiaBackend(options)`](../reference/api/decap/functions/createContentiaBackend) takes
these, all optional:

| Option                   | Type                                                              | Default           | Description                                                |
| ------------------------ | ----------------------------------------------------------------- | ----------------- | ---------------------------------------------------------- |
| `documentsApiBaseUrl`    | `string`                                                          | `{api}/documents` | Base URL of the documents API, for the default repository. |
| `assetsApiBaseUrl`       | `string`                                                          | `{api}/assets`    | Base URL of the assets API, for the default repository.    |
| `getDocumentsRepository` | `(options: GetDocumentsRepositoryOptions) => DocumentsRepository` | JSON:API proxy    | Returns the `DocumentsRepository` the backend uses.        |
| `getAssetsRepository`    | `(options: GetAssetsRepositoryOptions) => AssetsRepository`       | JSON:API proxy    | Returns the `AssetsRepository` the backend uses.           |
| `onWarning`              | `(error: ContentiaError) => void`                                 | `console.warn`    | Receives every recoverable warning from the repositories.  |

### Custom repositories

By default the backend reaches the server through the [JSON:API proxy](../adapters/jsonapi-proxy)
repositories. A factory can return any other repository instead: an in-memory one for Storybook or
tests, or one pointed at another origin. Each factory receives `tokenPromise`, which resolves to a
current bearer token (refreshing it first when it is about to expire), and `baseUrl`, the resolved
API root:

```ts
import { createContentiaBackend } from '@contentia/decap';
import { AssetsJsonApiProxyRepository } from 'contentia/assets/jsonapi-proxy';

const ContentiaBackend = createContentiaBackend({
  getAssetsRepository: ({ tokenPromise }) =>
    new AssetsJsonApiProxyRepository({
      tokenPromise,
      baseUrl: 'https://assets.example.com/api/assets',
    }),
});
```

### Recoverable warnings

A repository can succeed while reporting that something partly failed, such as a readback that fell
back to a synthesized resource. Each such warning reaches `onWarning` as a typed `ContentiaError`.
Record warnings as breadcrumbs, not errors, and tag them by `code`:

```ts
import { createContentiaBackend } from '@contentia/decap';
import * as Sentry from '@sentry/browser';

const ContentiaBackend = createContentiaBackend({
  onWarning: error => {
    Sentry.addBreadcrumb({
      category: 'contentia.warning',
      level: 'warning',
      message: error.message,
      data: { 'contentia.warning.code': error.code, 'contentia.warning.repo': 'decap' },
    });
  },
});
```
