# contentia

> A modular, runtime-agnostic content API.

One content API over any storage backend. Put your own UI or an existing admin in front of it, and
swap storage backends (filesystem, R2, GitHub, …) without rewriting code. Runs on Node, Bun, and
Cloudflare Workers.

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

### Server

`contentia/server/api` (the JSON:API router, `contentiaApi`) · `contentia/server/oauth2` (OAuth 2.0
authorization server) · `contentia/server/ai` (AI chat endpoints; `ai` and `@ai-sdk/*` are optional
peers). See [`src/server/README.md`](./src/server/README.md).

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

- [`@contentia/aws`](https://www.npmjs.com/package/@contentia/aws) — AWS service implementations
  (DynamoDB, S3 `StorageRepository`)

## Documentation

Full docs, architecture notes, and deployment guides live in the
[contentia repository](https://github.com/contentia-dev/contentia).

## Running tasks without Effect

Repository methods return a `ContentiaTask` (one result) or a `ContentiaStream` (many). Neither
needs Effect:

```ts
// A task is awaitable
const post = await repo.getObject('posts/hello');

// A stream is async-iterable: items arrive one at a time
for await (const atom of repo.listAtoms('posts', { depth: 1, pagination: {} })) {
  console.log(atom.key);
}

// ...or load them all at once
const { items, done } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
```

`task.run(options)` and `stream.collect(options)` take an optional `onProgress` callback, called for
every `ContentiaMetadata` event — both `Progress` and `RecoverableError` — as the task or stream
runs:

```ts
const result = await myTask.run({
  onProgress(meta) {
    if (meta._tag === 'Progress') console.log(meta.progress.message);
    if (meta._tag === 'RecoverableError') console.warn(meta.error);
  },
});

const { items, done } = await myStream.collect({
  onProgress(meta) {
    if (meta._tag === 'Progress') updateProgressBar(meta.progress);
  },
});
```

Without `onProgress` (including a plain `await` or `for await`), **`RecoverableError` and `Progress`
events are silently discarded**. Callers that need to surface warnings must pass the callback to
`run` or `collect`.

Tasks and streams are lazy, like Drizzle queries: nothing runs until you `await`, iterate, or
collect, and each time runs it again. A stream is not awaitable: `await repo.listAtoms(...)` does
nothing, so use `for await` or `.collect()`.

## License

MIT
