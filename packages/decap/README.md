# @contentia/decap

[![npm](https://img.shields.io/npm/v/@contentia/decap)](https://www.npmjs.com/package/@contentia/decap)
[![npm](https://img.shields.io/npm/dm/@contentia/decap)](https://www.npmjs.com/package/@contentia/decap)

Decap CMS backend for Contentia. Registered with Decap, it reads and writes entries and media
through the Contentia JSON:API (`contentia/server/api`) instead of a Git provider, so the admin
works against whatever storage the server is configured with.

## Install

```sh
pnpm add @contentia/decap contentia @laikacms/decap-cms react
```

The backend is built against `@laikacms/decap-cms` 4.2 or later, the Decap CMS v4 distribution that
publishes Decap's backend seam (`lib/backend`, `lib/util`) as subpath exports. Decap 3
(`decap-cms-app`) has a different backend interface and is not supported.

## Usage

Register the backend under a name and point the config's `backend:` block at it:

```ts
import { createContentiaBackend } from '@contentia/decap';
import { CMS, init } from '@laikacms/decap-cms/app/bare';

CMS.registerBackend('contentia', createContentiaBackend());
// `/bare` registers nothing else: register the widgets and the JSON entry codec your
// collections use, then call init().
init();
```

```yaml
backend:
  name: contentia
  base_url: https://api.example.com
  api_root: /api
  app_id: decap-cms
```

The server side is `contentiaApi` from `contentia/server/api`, mounted at `base_url` + `api_root`,
plus an OAuth 2.0 server for the login (`contentiaOauth2` from `contentia/server/oauth2`, or any
other provider). The backend talks to these endpoints:

| Endpoint                      | Used for                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| `{api}/session`               | Resolving the signed-in user after login                       |
| `{api}/health`                | Decap's backend status check                                   |
| `{api}/documents`             | Entries, the editorial workflow and change polling             |
| `{api}/assets`                | The media library                                              |
| `{api}/locks`                 | Advisory entry locking (optional, see [below](#entry-locking)) |
| `{base_url}/oauth2/authorize` | The PKCE login redirect                                        |
| `{base_url}/oauth2/token`     | The token exchange and the refresh grant                       |

## Config

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
| `dev_token`                        | `string`   | no                 | **Development only. Never set it in production.** A pre-shared bearer token that skips the OAuth flow: the login page logs in with it automatically, and every page load authenticates with it, ignoring any stored session. Pair it with a server that accepts the same token, such as `createEmbeddedContentia({ auth: { mode: 'dev', devToken } })` from `contentia/server/decap`.                   |
| `acceptRoles`                      | `string[]` | no                 | Role allowlist. When non-empty, the `role` attribute `/session` returns must be one of these values, or login fails with a `403` and no session is stored. A session without a `role` is rejected. Omit it, or set `[]`, to admit any authenticated session. `/session` returns the `User` your `authenticateAccessToken` resolved, so add `role` to it by augmenting `User` in `contentia/server/api`. |

## Local and remote backends: `resolveContentiaBackend()`

`resolveContentiaBackend({ local, remote, dev })` picks the `backend:` block for the current build,
so one admin config targets the local JSON:API `@contentia/vite-plugin` mounts while you run
`vite dev`, and the remote OAuth backend everywhere else:

- `import.meta.env.DEV` truthy → a local config pointing at the plugin's JSON:API, logging in with a
  dummy dev token (local mode has no auth).
- Falsy, or `import.meta.env` not defined at all (a production build, `vite preview`, a non-Vite
  bundle) → `remote`, unchanged. An admin loaded outside a Vite dev build never targets a local
  endpoint that isn't there.

```ts
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

Call it from the admin's TypeScript entry point, not from `config.yml`, which has no access to
`import.meta.env`.

`ResolveContentiaBackendOptions`:

| Option   | Type                           | Required | Description                                                                            |
| -------- | ------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `remote` | `ContentiaBackendModuleConfig` | yes      | The `backend:` block for the OAuth flow, returned as-is unless the dev flag is truthy. |
| `local`  | `LocalContentiaBackendOptions` | no       | Local-mode overrides (below).                                                          |
| `dev`    | `boolean`                      | no       | Overrides `import.meta.env.DEV`. Leave it out at real call sites; it exists for tests. |

`LocalContentiaBackendOptions`:

| Key        | Type     | Default                                                   | Description                                                                                        |
| ---------- | -------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `basePath` | `string` | `/__contentia` (`DEFAULT_LOCAL_BACKEND_BASE_PATH`)        | Where the local JSON:API is mounted. Must match `localApi.basePath` on `@contentia/vite-plugin`.   |
| `devToken` | `string` | `contentia-local-dev` (`DEFAULT_LOCAL_BACKEND_DEV_TOKEN`) | The dummy token the dev login page submits. It only has to be non-empty and stable across reloads. |

## Options

`createContentiaBackend(options)` takes these, all optional:

| Option                   | Type                                                              | Default           | Description                                                |
| ------------------------ | ----------------------------------------------------------------- | ----------------- | ---------------------------------------------------------- |
| `documentsApiBaseUrl`    | `string`                                                          | `{api}/documents` | Base URL of the documents API, for the default repository. |
| `assetsApiBaseUrl`       | `string`                                                          | `{api}/assets`    | Base URL of the assets API, for the default repository.    |
| `getDocumentsRepository` | `(options: GetDocumentsRepositoryOptions) => DocumentsRepository` | JSON:API proxy    | Returns the `DocumentsRepository` the backend uses.        |
| `getAssetsRepository`    | `(options: GetAssetsRepositoryOptions) => AssetsRepository`       | JSON:API proxy    | Returns the `AssetsRepository` the backend uses.           |
| `onWarning`              | `(error: ContentiaError) => void`                                 | `console.warn`    | Receives every recoverable warning from the repositories.  |

### Custom repositories

By default the backend reaches the server through `DocumentsJsonApiProxyRepository` and
`AssetsJsonApiProxyRepository`. A factory can return any other repository instead: an in-memory one
for Storybook or tests, or one pointed at another origin. Each factory receives:

```ts
interface GetDocumentsRepositoryOptions /* and GetAssetsRepositoryOptions */ {
  /** Resolves to a current bearer token, refreshing it first when it is about to expire. */
  tokenPromise: () => Promise<string>;
  /**
   * The resolved API root: `base_url` combined with `api_root`. Not `documentsApiBaseUrl` or
   * `assetsApiBaseUrl`: those only feed the default factories.
   */
  baseUrl: string;
}
```

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

### Recoverable warnings: `onWarning`

A repository can succeed while reporting that something partly failed, such as a readback that fell
back to a synthesised resource. Each such warning reaches `onWarning` as a typed `ContentiaError`.
Without a handler it is logged with `console.warn`. Record warnings as breadcrumbs, not errors, and
tag them by `code`:

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

## Session storage

After login the session (access token, refresh token, expiry) lives in `sessionStorage`, under
`ACCESS_TOKEN_STORAGE_KEY` (`contentia_access_token`), `REFRESH_TOKEN_STORAGE_KEY` and
`TOKEN_EXPIRES_AT_STORAGE_KEY`. The access token is refreshed with the refresh grant shortly before
it expires; the server rotates the pair on refresh, so the backend shares one in-flight refresh
between concurrent requests.

A host app that calls its own API with the CMS session should get the token from the backend's
`getToken()`, which refreshes it when needed. Read `ACCESS_TOKEN_STORAGE_KEY` only as a fallback
before the backend has authenticated: a second refresher of its own would revoke the CMS's session.

## Supported collection formats

**Only `format: json` collections are supported.** The documents API stores `content` as a plain
object, which only JSON entries produce. A collection without `format:` defaults to markdown with
frontmatter, so set it explicitly:

```yaml
collections:
  - name: posts
    label: Posts
    folder: posts
    format: json
    fields:
      - { label: Title, name: title, widget: string }
```

Saving an entry in any other format fails in the browser, before any request reaches the server
(media uploads included), with:

```
The Contentia backend currently only supports JSON-format collections; set `format: json` on collection `posts`.
```

## Media

The media library lists, uploads and deletes through `{api}/assets`. An upload is stored under its
file name inside the assets folder, and Decap shows it under `public_folder`. The assets folder is
`media_folder` unless `assets_folder` says otherwise:

| `assets_folder`         | `uploads/logo.png` is stored as | Fits                                                                                         |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| not set: `media_folder` | `uploads/logo.png`              | `CatalogAssetsRepository` (`contentia/assets/catalog`), and a bucket shared with other files |
| `''`                    | `logo.png`                      | An assets store that holds only media, at its root, such as a dedicated R2 bucket            |
| `media`                 | `media/logo.png`                | Media in a folder of its own, whatever `media_folder` is                                     |

`CatalogAssetsRepository`, which `createEmbeddedContentia` and the Vite plugin's local API use,
reads a key's first segment as its media collection, so the default layout is the one it serves.
With `resolveContentiaBackend()`, set `assets_folder` on `remote` only: the local backend keeps the
default.

## Editorial workflow

With `publish_mode: editorial_workflow`, drafts are unpublished records in the documents repository,
and Decap's statuses map onto the record's `status`. Publishing calls `publish`. Unpublishing moves
a live entry back to a draft with its content intact when the Decap build calls the backend's
optional `unpublishEntry`; a build that doesn't (4.2.0 included) deletes the published record
instead. Deploy previews are not supported.

## Entry locking

When two editors open the same entry, the second sees a "being edited by" banner, arbitrated by the
server rather than by one browser's local state. The backend implements Decap's optional lock
methods against `{api}/locks`, which `contentiaApi` serves from the documents repository's lock
methods or a `LockManager`.

- **The owner is never sent.** The server derives the lock owner from the authenticated user, so
  nobody can take a lock as somebody else.
- **The client holds a token.** Acquiring returns an opaque token, kept in memory per entry and sent
  on refresh and release; the server authorises on the token. Tokens are dropped on logout. Reading
  a lock never returns one.

| Server response | Behaviour                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `423 Locked`    | Rejects, so Decap fetches the holder and shows the conflict banner.                                                    |
| `204` or `501`  | The deployment cannot lock. Resolves `null`, hides the lock UI, and stops calling `/locks` until the page is reloaded. |
| network failure | Resolves `null`, so locking degrades instead of blocking the edit. The next call tries again.                          |

Locks are advisory: nothing blocks a write. In a multi-node deployment, check
`documents.getCapabilities().locks.scope`: `InProcessLockManager` (`contentia/locks/in-process`)
reports `'in-process'`, which is right for one node but invisible across nodes.

## License

MIT
