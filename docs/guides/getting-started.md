---
title: Getting Started
---

<script setup>
import BackendSwitch from '../.vitepress/theme/home/BackendSwitch.vue'
</script>

::: tip Not using TypeScript or JavaScript?

You don't need to write any. `contentia serve --config` runs the Contentia API from one config file,
and any language can call it over HTTP. See [Server Config](../reference/server-config), then the
[HTTP API](../reference/json-api/) reference for every route.

:::

::: tip Using Effect?

[Getting Started with Effect](./getting-started-effect) covers the same steps inside `Effect.gen`,
with typed errors, Effect `Stream`s, and backends provided as a `Layer`.

:::

## Installation

```bash
pnpm add contentia
```

`contentia` runs anywhere modern JavaScript runs: Node.js, Bun, Deno, Cloudflare Workers, and the
browser. Import only the subpaths you use.

## Create a backend

Since "backend" can mean lots of different things, Contentia calls them "repositories", inspired by
Domain-Driven Design.

A repository needs three things: where the content lives, the serializers it may read and write, and
the file extension new objects get.

```typescript
import { jsonSerializer } from 'contentia/serializers/json';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const repo = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
```

Keys should not include the extension of the object: the object `posts/hello` is stored as
`./content/posts/hello.json`.

::: details Why no extension?

Since Contentia abstracts the storage layer, using an extension in the key means you need to rename
all your keys if you move your content into a database, or switch the file format to YAML for
example. File-based repositories do return the file extension as metadata (`metadata.extension`) for
specific edge cases.

:::

Serializers for YAML, Markdown with frontmatter, and raw files live next to the JSON one
(`contentia/serializers/yaml`, `…/markdown`, `…/raw`).

## Write and read objects

```typescript
await repo.createObject({
  key: 'posts/hello',
  content: { title: 'Hello, Contentia' },
});

const post = await repo.getObject('posts/hello');
console.log(post.content.title); // "Hello, Contentia"

await repo.updateObject({
  key: 'posts/hello',
  content: { title: 'Hello again' },
});
```

Like a database query builder, a task is lazy: nothing happens until you `await` it.

A failed task rejects with a typed
[`ContentiaError`](../reference/api/contentia/core/errors/classes/ContentiaError). Check its `code`
(for example `not_found`) instead of matching on the message:

```typescript
try {
  await repo.getObject('posts/missing');
} catch (error) {
  if (error.code === 'not_found') {
    // render a 404
  }
}
```

## List a folder

Listings are [streams](../reference/api/contentia/core/namespaces/ContentiaStream/), so a large
folder never has to fit in memory at once. Iterate one with `for await`:

```typescript
for await (const atom of repo.listAtoms('posts', { depth: 1, pagination: {} })) {
  console.log(atom.key, atom.type); // "posts/hello object"
}
```

When you do want everything in one array, `collect()` loads it:

```typescript
const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
```

A stream can't be awaited directly: `await repo.listAtoms(...)` does nothing. Use `for await` or
`collect()`.

An **atom** is anything in the tree: an object or a folder. `depth` controls how far the listing
recurses, and `pagination` accepts offset, page, or cursor (`before` / `after`) styles, depending on
what the backend supports. See [Content Model](../concepts/content-model) for the full shape.

### Recoverable warnings

Some operations partly fail but still produce a usable result, for example a listing that skipped
one corrupt file. Those come back as warnings next to the result instead of failing the call. Pass
`onProgress` to `collect()`, or to `run()` on a task, to see them:

```typescript
const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect({
  onProgress(meta) {
    if (meta._tag === 'RecoverableError') console.warn(meta.error.code, meta.error.message);
  },
});

const post = await repo.getObject('posts/hello').run({ onProgress: meta => console.log(meta) });
```

Without `onProgress`, including a plain `await` or `for await`, warnings are dropped.

## Swap the backend

Every backend implements the same
[`StorageRepository`](../reference/api/contentia/storage/classes/StorageRepository) interface, so
switching is a constructor change. The code that reads and writes content stays the same. Pick a
backend to see its setup:

<BackendSwitch file="content.ts">

::: code-group

```ts{2,4} [Filesystem]
import { jsonSerializer } from 'contentia/serializers/json';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const repo = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');

// the same calls on every backend
const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
```

```ts{2,4,5} [Cloudflare R2]
import { jsonSerializer } from 'contentia/serializers/json';
import { R2StorageRepository } from 'contentia/storage/r2';

// inside a Worker's fetch handler, where `env` holds the bucket binding
const repo = new R2StorageRepository(env.CONTENT_BUCKET, { json: jsonSerializer }, 'json');

// the same calls on every backend
const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
```

```ts{2,3,5-12} [GitHub]
import { jsonSerializer } from 'contentia/serializers/json';
import { Octokit } from '@octokit/rest';
import { GithubStorageRepository } from 'contentia/storage/github';

const repo = new GithubStorageRepository({
  owner: 'acme',
  repo: 'content',
  branch: 'main',
  octokit: new Octokit({ auth: process.env.GITHUB_TOKEN }),
  serializerRegistry: { json: jsonSerializer },
  defaultFileExtension: 'json',
});

// the same calls on every backend
const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
```

```ts{2,4-11} [WebDAV]
import { jsonSerializer } from 'contentia/serializers/json';
import { WebDavStorageRepository } from 'contentia/storage/webdav';

const repo = new WebDavStorageRepository(
  {
    baseUrl: 'https://dav.example.com/content',
    auth: { username: 'alice', password: process.env.DAV_PASSWORD },
  },
  { json: jsonSerializer },
  'json',
);

// the same calls on every backend
const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
```

:::

</BackendSwitch>

[Adapters](../adapters/) lists every backend: git hosts, object storage, SQL databases, the
filesystem, and the browser.

<!--@include: ../.vitepress/adapters/logos.md-->

## Serve it over HTTP

[`buildJsonApi`](../reference/api/contentia/storage/api/functions/buildJsonApi) turns any storage
repository into a [JSON:API](../reference/json-api/) handler. It returns a standard
`fetch(request): Promise<Response>` function, so it runs on any runtime that speaks the Fetch API.

```typescript
import { allowAll } from 'contentia/json-api';
import { jsonSerializer } from 'contentia/serializers/json';
import { buildJsonApi } from 'contentia/storage/api';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const repo = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
export const api = buildJsonApi({ repo, authorize: allowAll });
```

[Mount the API](./api-server#mount-the-api) shows how to serve `api.fetch` on your runtime or mount
it in your framework. To mount it under a path such as `/api`, create it with `basePath: '/api'`.

::: tip Want a standalone server instead?

If your apps should talk to a Contentia server directly rather than embed one, skip the server code:
[Server Config](../reference/server-config) runs the full API (documents, storage, and assets) from
one config file, with authentication, on Node.

:::

`authorize` is required. There is no implicit "allow everything" default:
[`allowAll`](../reference/api/contentia/json-api/functions/allowAll) is the explicit way to say a
surface is intentionally open, and it's only safe on a local dev server or behind something that
already authenticated the request.

`authorize` runs once for every action, before the repository is touched. It receives the action and
the original `Request`. Return `true` to allow it, or `false` to deny it with a 403. A read-only API
is an allow-list of read actions:

```typescript
const READS = new Set([
  'getCapabilities',
  'readOpenApi',
  'listAtoms',
  'listAtomSummaries',
  'getObject',
  'getFolder',
  'getAtom',
]);

const api = buildJsonApi({ repo, authorize: ({ action }) => READS.has(action) });
```

The handler also serves its own OpenAPI spec, so any HTTP client or LLM tool can discover the API.
The [Storage API](../reference/json-api/storage) reference renders that spec, with every route and
schema.

## Next steps

- [Repositories](../concepts/repositories): the repository pattern, and how to write your own
- [Content Model](../concepts/content-model): atoms, folders, the `body` convention, change tracking
- [Architecture](../concepts/architecture): how the storage, documents, and API layers fit together
- [API Server](./api-server): documents, storage, and assets behind one endpoint, with
  authentication
- [Server Config](../reference/server-config): the same API from one config file, with no server
  code
- [Adapters](../adapters/): every supported backend
- [HTTP API](../reference/json-api/): every route and schema, plus conventions, pagination, and
  errors
- [Imports](../reference/imports): every import path and its install command
