# Imports

Every import path, grouped by what it does. The **Install** column is the command that makes the
import available; everything else works the same whichever install it comes from.

Storage, documents, and assets backends are listed separately under [Adapters](../adapters/).

## Content

The interfaces every backend implements, and the JSON:API handlers that serve them over HTTP.

| Import                    | Install              | What it does                                                                                                                 |
| ------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `contentia/storage`       | `pnpm add contentia` | [`StorageRepository`](./api/contentia/storage/classes/StorageRepository): objects, folders, and atoms                        |
| `contentia/documents`     | `pnpm add contentia` | [`DocumentsRepository`](./api/contentia/documents/classes/DocumentsRepository): documents with drafts, publishing, revisions |
| `contentia/assets`        | `pnpm add contentia` | [`AssetsRepository`](./api/contentia/assets/classes/AssetsRepository): media files with URLs and image variations            |
| `contentia/catalog`       | `pnpm add contentia` | [`CatalogProvider`](./api/contentia/catalog/classes/CatalogProvider): collections and their JSON Schemas                     |
| `contentia/storage/api`   | `pnpm add contentia` | [`buildJsonApi`](./api/contentia/storage/api/functions/buildJsonApi): a storage repository as a JSON:API handler             |
| `contentia/documents/api` | `pnpm add contentia` | A documents repository as a JSON:API handler                                                                                 |
| `contentia/assets/api`    | `pnpm add contentia` | An assets repository as a JSON:API handler                                                                                   |
| `contentia/catalog-api`   | `pnpm add contentia` | Catalog settings as a JSON:API handler                                                                                       |
| `contentia/json-api`      | `pnpm add contentia` | Shared JSON:API helpers, including the explicit [`allowAll`](./api/contentia/json-api/functions/allowAll) policy             |

## Catalogs

Where collection definitions come from.

| Import                         | Install                             | What it does                                                                                                                                       |
| ------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentia/catalog-convention` | `pnpm add contentia`                | Collections by convention: each collection is the folder with the same name. Defaults are created on first use, no seeding needed.                 |
| `contentia/catalog-decap`      | `pnpm add contentia`                | Collections derived from a Decap CMS config, so the server and the editor share one source of truth. Supports multi-folder and nested collections. |
| `@contentia/aws/catalog-ddb`   | `pnpm add contentia @contentia/aws` | Catalog settings stored in DynamoDB                                                                                                                |

## Serializers

Any serializer works with any storage adapter. Register one per file extension.

| Import                           | Install              | What it does                     |
| -------------------------------- | -------------------- | -------------------------------- |
| `contentia/serializers/json`     | `pnpm add contentia` | JSON                             |
| `contentia/serializers/yaml`     | `pnpm add contentia` | YAML                             |
| `contentia/serializers/markdown` | `pnpm add contentia` | Markdown with frontmatter        |
| `contentia/serializers/raw`      | `pnpm add contentia` | Raw text or binary, stored as-is |

## Running tasks

| Import             | Install              | What it does                                                                                                                                                                                                                                              |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentia/compat` | `pnpm add contentia` | [`runTask`](./api/contentia/compat/functions/runTask) and [`collectStream`](./api/contentia/compat/functions/collectStream): run tasks and streams as Promises, without importing Effect. Pass `onProgress` to receive progress and recoverable warnings. |
| `contentia/core`   | `pnpm add contentia` | [`ContentiaTask`](./api/contentia/core/namespaces/ContentiaTask/), [`ContentiaStream`](./api/contentia/core/namespaces/ContentiaStream/), shared types, and errors, for code that uses Effect directly                                                    |

## Errors

| Import                        | Install              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentia/core/errors`       | `pnpm add contentia` | Every [`ContentiaError`](./api/contentia/core/errors/classes/ContentiaError) class. Commonly caught: [`NotFoundError`](./api/contentia/core/errors/classes/NotFoundError), [`BadRequestError`](./api/contentia/core/errors/classes/BadRequestError), [`ForbiddenError`](./api/contentia/core/errors/classes/ForbiddenError), [`LockConflictError`](./api/contentia/core/errors/classes/LockConflictError), [`VersionMismatchError`](./api/contentia/core/errors/classes/VersionMismatchError), [`EntryAlreadyExistsError`](./api/contentia/core/errors/classes/EntryAlreadyExistsError), [`TooManyRequestsError`](./api/contentia/core/errors/classes/TooManyRequestsError) |
| `contentia/core/errors-extra` | `pnpm add contentia` | HTTP mapping for errors: [`ErrorCodeToStatusMap`](./api/contentia/core/errors-extra/variables/ErrorCodeToStatusMap) (error code to HTTP status), [`ErrorCodeToKeyMap`](./api/contentia/core/errors-extra/variables/ErrorCodeToKeyMap), [`ErrorClasses`](./api/contentia/core/errors-extra/variables/ErrorClasses)                                                                                                                                                                                                                                                                                                                                                           |

## Serving and authentication

| Import                          | Install                                | What it does                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@contentia/server/api`         | `pnpm add contentia @contentia/server` | [`contentiaApi`](../guides/api-server): documents, storage, and assets behind one authenticated endpoint                                                                                                                                                                                                                                                                        |
| `@contentia/server/oauth2`      | `pnpm add contentia @contentia/server` | A self-contained OAuth2 login server: PKCE, email and password, passkeys, TOTP two-factor                                                                                                                                                                                                                                                                                       |
| `@contentia/server/oauth2/i18n` | `pnpm add contentia @contentia/server` | Translations for the login pages (`…/en`, `…/nl`)                                                                                                                                                                                                                                                                                                                               |
| `contentia/auth`                | `pnpm add contentia`                   | Scopes ([`hasScope`](./api/contentia/auth/functions/hasScope), [`requireScope`](./api/contentia/auth/functions/requireScope), …), personal access tokens ([`mintPersonalAccessToken`](./api/contentia/auth/functions/mintPersonalAccessToken), [`hashToken`](./api/contentia/auth/functions/hashToken), …), and [`resolveBearer`](./api/contentia/auth/functions/resolveBearer) |
| `contentia/locks/in-process`    | `pnpm add contentia`                   | [`InProcessLockManager`](./api/contentia/locks/in-process/classes/InProcessLockManager): advisory document locks for a single server process                                                                                                                                                                                                                                    |

See [Authentication](../guides/decap/auth) for how these fit together.

## Uploads

| Import                     | Install              | What it does                                                                                                                                                                                                                                              |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentia/file-sanitizer` | `pnpm add contentia` | Strips privacy-sensitive metadata from PNG, GIF, WebP, and JPEG uploads, and scans for dangerous content ([`sanitizeFile`](./api/contentia/file-sanitizer/functions/sanitizeFile), [`canSanitize`](./api/contentia/file-sanitizer/functions/canSanitize)) |
| `contentia/sanitizer`      | `pnpm add contentia` | The [`Sanitizer`](./api/contentia/sanitizer/interfaces/Sanitizer) interface assets repositories accept, for plugging in your own sanitizer                                                                                                                |

## Integrations

| Import                     | Install                                     | What it does                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@contentia/astro`         | `pnpm add contentia @contentia/astro`       | [Astro](../guides/astro) integration: dev JSON:API, content hot reload, types                                                                                                                                                              |
| `@contentia/astro/loader`  | `pnpm add contentia @contentia/astro`       | Content Layer loaders: [`documentsLoader()`](./api/astro/loader/functions/documentsLoader), [`objectsLoader()`](./api/astro/loader/functions/objectsLoader), [`contentiaCollections()`](./api/astro/loader/functions/contentiaCollections) |
| `@contentia/astro/live`    | `pnpm add contentia @contentia/astro`       | [`liveDocumentsLoader()`](./api/astro/live/functions/liveDocumentsLoader) for live collections and draft previews                                                                                                                          |
| `@contentia/astro/api`     | `pnpm add contentia @contentia/astro`       | [`createApiHandler`](./api/astro/api/functions/createApiHandler): serve the API from an Astro route                                                                                                                                        |
| `@contentia/astro/testing` | `pnpm add contentia @contentia/astro`       | A fake `LoaderContext` for testing loaders without booting Astro                                                                                                                                                                           |
| `@contentia/vite-plugin`   | `pnpm add contentia @contentia/vite-plugin` | [Vite](../guides/vite) plugin: import content as ES modules at build time                                                                                                                                                                  |

## Decap CMS

| Import                               | Install                                                                | What it does                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laikacms/decap-cms`                | `pnpm add '@laikacms/decap-cms@^4.1.0' @emotion/react @emotion/styled` | The Contentia-enabled Decap CMS editor ([details](../guides/decap/fork))                                                                                            |
| `@laikacms/decap-cms/backends/laika` | same as above                                                          | `createLaikaBackend()`: connects the editor to your Contentia API                                                                                                   |
| `@laikacms/decap-cms/widgets/*`      | same as above                                                          | Extra [widgets](../guides/decap/widgets-and-editors): AI chat, icon pickers                                                                                         |
| `@contentia/server/ai`               | `pnpm add contentia @contentia/server ai`                              | Server side of the editor's [AI assistant](../guides/ai-assistant)                                                                                                  |
| `@contentia/server/embedded`         | `pnpm add contentia @contentia/server`                                 | [`createEmbeddedContentia()`](./api/server/embedded/functions/createEmbeddedContentia): a complete filesystem-backed backend from one options object (Node.js only) |
| `@contentia/git-gateway`             | `pnpm add @contentia/git-gateway hono`                                 | A [Netlify git-gateway](../guides/decap/git-gateway) replacement                                                                                                    |

## Writing your own adapter

| Import                        | Install              | What it does                                                                                                                                                                              |
| ----------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentia/storage/testing`   | `pnpm add contentia` | Contract tests for `StorageRepository` implementations                                                                                                                                    |
| `contentia/documents/testing` | `pnpm add contentia` | Contract tests for `DocumentsRepository`, plus [`InMemoryDocumentsRepository`](./api/contentia/documents/testing/classes/InMemoryDocumentsRepository), a fast in-memory backend for tests |
| `contentia/assets/testing`    | `pnpm add contentia` | Contract tests for `AssetsRepository` implementations                                                                                                                                     |

## Utilities

| Import                     | Install              | What it does                                                                                                                                                                                                                                         |
| -------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentia/core/utilities` | `pnpm add contentia` | Dependency-free helpers (`memoize`, `lazy`, [`Url`](./api/contentia/core/utilities/variables/Url), [`Header`](./api/contentia/core/utilities/variables/Header), [`Paths`](./api/contentia/core/utilities/variables/Paths)) that don't pull in Effect |
| `contentia/core/types/*`   | `pnpm add contentia` | Individual type modules: `datetime`, `mime-type`, `pagination`, `role`, …                                                                                                                                                                            |
| `contentia/crypto`         | `pnpm add contentia` | Hashing, password hashing, constant-time comparison, randomness. Import `contentia/crypto/<module>` to pull in one part only                                                                                                                         |
| `contentia/i18n`           | `pnpm add contentia` | Shared UI strings: OK, Cancel, Save, … (`…/en`, `…/nl`)                                                                                                                                                                                              |

Older dashed import names (`contentia/storage-fs`, `contentia/storage-serializers-json`, …) are
aliases of the paths above and resolve to the same modules.
