# contentia

> A modular, runtime-agnostic content API.

One content API over any storage backend. Use it with [Decap CMS](https://decapcms.org/) or your own
UI, and swap storage backends (filesystem, R2, GitHub, …) without rewriting code. Runs on Node, Bun,
and Cloudflare Workers.

```bash
pnpm add contentia
```

## Quick start

### Node / Bun

```ts
import { allowAll } from 'contentia/json-api';
import { markdownSerializer } from 'contentia/serializers/markdown';
import { buildJsonApi } from 'contentia/storage/api';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const repo = new FileSystemStorageRepository('./content', { md: markdownSerializer }, 'md');
const api = buildJsonApi({ repo, authorize: allowAll });

export default { fetch: api.fetch };
```

### Cloudflare Workers

```ts
import { allowAll } from 'contentia/json-api';
import { markdownSerializer } from 'contentia/serializers/markdown';
import { buildJsonApi } from 'contentia/storage/api';
import { R2StorageRepository } from 'contentia/storage/r2';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: markdownSerializer }, 'md');
    return buildJsonApi({ repo, authorize: allowAll }).fetch(request);
  },
};
```

## What's in the box

`contentia` is a single package with many focused subpath exports. Import only what you need.

### APIs (JSON:API HTTP layer)

| Export                    | Purpose                            |
| ------------------------- | ---------------------------------- |
| `contentia/storage/api`   | Storage CRUD over JSON:API         |
| `contentia/documents/api` | Document/record CRUD over JSON:API |
| `contentia/assets/api`    | Asset metadata + uploads           |
| `contentia/catalog-api`   | Catalog settings management        |

### Domain (interfaces & entities)

| Export                | Purpose                         |
| --------------------- | ------------------------------- |
| `contentia/storage`   | `StorageRepository` interface   |
| `contentia/documents` | `DocumentsRepository` interface |
| `contentia/assets`    | `AssetsRepository` interface    |
| `contentia/catalog`   | `SettingsProvider` interface    |

### Implementations

| Export                              | Backs                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentia/storage/fs`              | Filesystem                                                                                                                                                                |
| `contentia/storage/r2`              | Cloudflare R2                                                                                                                                                             |
| `contentia/storage/s3`              | S3→R2Bucket adapter (`createS3Bucket()`) — use with `R2StorageRepository`; **not** a `StorageRepository` itself. Full S3 `StorageRepository`: `@contentia/aws/storage-s3` |
| `contentia/storage/webdav`          | WebDAV server                                                                                                                                                             |
| `contentia/storage/drizzle`         | SQL via Drizzle                                                                                                                                                           |
| `contentia/storage/jsonapi-proxy`   | Remote JSON:API server                                                                                                                                                    |
| `contentia/storage/web`             | Web Storage (`localStorage` / `sessionStorage`) — browser / SSR-safe                                                                                                      |
| `contentia/storage/web-fs`          | Browser File System API (`FileSystemDirectoryHandle`) — local-first, no server required                                                                                   |
| `contentia/storage-github-cdn`      | Read-only public GitHub repo via jsDelivr CDN — no token, no `@octokit/*` dependency                                                                                      |
| `contentia/documents/catalog`       | Documents on top of `storage`                                                                                                                                             |
| `contentia/documents/drizzle`       | Documents in SQL                                                                                                                                                          |
| `contentia/documents/jsonapi-proxy` | Documents via JSON:API proxy                                                                                                                                              |
| `contentia/documents/obsidian`      | Obsidian-vault-backed documents                                                                                                                                           |
| `contentia/assets/catalog`          | Assets on top of `storage`                                                                                                                                                |
| `contentia/assets/r2`               | Assets in R2                                                                                                                                                              |
| `contentia/assets/jsonapi-proxy`    | Assets via JSON:API proxy                                                                                                                                                 |
| `contentia/assets/obsidian`         | Obsidian-vault-backed assets — **Node.js / Bun only** (uses `node:fs` / `node:path` / `node:stream`; not available on Cloudflare Workers)                                 |
| `contentia/catalog-convention`      | In-memory / file-backed settings                                                                                                                                          |
| `contentia/catalog-decap`           | Decap-CMS-compatible settings                                                                                                                                             |
| `contentia/locks/in-process`        | In-process advisory document locking (ADR-007) — `InProcessLockManager`, single-node only (`scope: 'in-process'`)                                                         |

### Testing utilities

| Export                        | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `contentia/documents/testing` | Contract test harness for `DocumentsRepository` implementations |
| `contentia/storage/testing`   | Contract test harness for `StorageRepository` implementations   |
| `contentia/assets/testing`    | Contract test harness for `AssetsRepository` implementations    |

### Serializers

`contentia/serializers/json` · `…-yaml` · `…-markdown` · `…-raw`

### Shared utilities

`contentia/core` · `contentia/crypto` · `contentia/file-sanitizer` · `contentia/sanitizer` ·
`contentia/json-api` · `contentia/i18n` (`/en`, `/nl`) · `contentia/auth`

## Companion packages

- [`@contentia/github`](https://www.npmjs.com/package/@contentia/github) — GitHub-backed storage
  repository
- [`@contentia/aws`](https://www.npmjs.com/package/@contentia/aws) — AWS service implementations
  (DynamoDB, S3 `StorageRepository`)
- [`@contentia/server`](https://www.npmjs.com/package/@contentia/server) — API, OAuth2, AI, and
  embedded Node.js server
- [`@laikacms/decap-cms`](https://www.npmjs.com/package/@laikacms/decap-cms) — Contentia-aware Decap
  CMS fork with AI chat widget (`…/widgets/aichat`), icon widgets, embedded-entry editor, and config
  type utilities (`@contentia/decap-ai` is discontinued; AI features moved here)

## Documentation

Full docs, architecture notes, and deployment guides live in the
[contentia repository](https://github.com/contentia-dev/contentia).

## Compat helpers — Promise-friendly entry points

`contentia/compat` exports two Promise-friendly wrappers for non-Effect consumers:

- **`runTask(task, options?)`** — runs a `ContentiaTask` and resolves with its value.
- **`collectStream(stream, options?)`** — drains a `ContentiaStream` and resolves with
  `{ items, done }`.

Both accept an optional `onProgress` callback that is called for every `ContentiaMetadata` event —
both `Progress` and `RecoverableError` — as the task/stream runs.

```ts
import { collectStream, runTask } from 'contentia/compat';

// Task — receive progress events without importing Effect
const result = await runTask(myTask, {
  onProgress(meta) {
    if (meta._tag === 'Progress') console.log(meta.progress.message);
    if (meta._tag === 'RecoverableError') console.warn(meta.error);
  },
});

// Stream — metadata fires live; data is still collected into items
const { items, done } = await collectStream(myStream, {
  onProgress(meta) {
    if (meta._tag === 'Progress') updateProgressBar(meta.progress);
  },
});
```

Omitting `options` (or `onProgress`) uses a data-only fast path. Note that when `onProgress` is
omitted, **`RecoverableError` and `Progress` events are silently discarded** — callers that need to
surface warnings or non-fatal errors must supply the callback.

`runTask` without `onProgress` drains metadata chunks through the Effect channel (queue allocations
and Effect pulls still occur) but does not allocate metadata arrays or fire any callback.
`collectStream` without `onProgress` performs a data-only drain: no metadata arrays are allocated
and no callback is fired, though channel overhead still applies.

## License

MIT
