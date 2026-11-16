---
title: Getting Started with Effect
---

::: tip Not using Effect?

[Getting Started](./getting-started) covers the same steps with plain `await` and `for await`. You
don't need Effect to use Contentia.

:::

## Installation

```bash
pnpm add contentia effect
```

Contentia is built on [Effect](https://effect.website/) 4 and depends on `effect` with a caret range
(`pnpm view contentia dependencies.effect` prints it). Any `effect` in that range resolves to one
copy shared by your code and Contentia. An older `effect` in your project gets its own copy, and
TypeScript rejects programs that mix the two, so upgrade it to the range's minimum.

## Create a backend

Contentia calls a backend a **repository**. A repository needs three things: where the content
lives, the serializers it may read and write, and the file extension new objects get.

```typescript
import { jsonSerializer } from 'contentia/serializers/json';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const repo = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
```

Keys never include the extension: the object `posts/hello` is stored as
`./content/posts/hello.json`. [Getting Started](./getting-started#create-a-backend) explains why,
and lists the other serializers.

## Write and read objects

Repository methods return a
[`ContentiaTask`](../reference/api/contentia/core/namespaces/ContentiaTask/): an Effect `Channel`
that can emit progress events and recoverable warnings, then ends with one value.
[`ContentiaTask.runValue`](../reference/api/contentia/core/namespaces/ContentiaTask/functions/runValue)
turns a task into an `Effect<A, ContentiaError>` you can `yield*`:

```typescript
import { ContentiaTask } from 'contentia/core';
import { Effect } from 'effect';

const program = Effect.gen(function*() {
  yield* ContentiaTask.runValue(repo.createObject({
    key: 'posts/hello',
    content: { title: 'Hello, Contentia' },
  }));

  const post = yield* ContentiaTask.runValue(repo.getObject('posts/hello'));
  console.log(post.content.title); // "Hello, Contentia"

  yield* ContentiaTask.runValue(repo.updateObject({
    key: 'posts/hello',
    content: { title: 'Hello again' },
  }));
});

await Effect.runPromise(program);
```

Like any Effect, nothing touches storage until the program runs, and every run runs the tasks again.

### Handle errors

A failed task fails the Effect with a typed
[`ContentiaError`](../reference/api/contentia/core/errors/classes/ContentiaError). It is a class
with a `code`, not a tagged error, so `Effect.catchTag` doesn't apply. Match on the `code` (for
example `not_found`) with `Effect.catchIf`:

```typescript
const title = ContentiaTask.runValue(repo.getObject('posts/missing')).pipe(
  Effect.map(post => post.content.title),
  Effect.catchIf(error => error.code === 'not_found', () => Effect.succeed('Untitled')),
);
```

## List a folder

Listings return a [`ContentiaStream`](../reference/api/contentia/core/namespaces/ContentiaStream/).
[`ContentiaStream.runCollect`](../reference/api/contentia/core/namespaces/ContentiaStream/functions/runCollect)
runs one to the end and returns its items as `data`, together with any warnings and the closing
`done` value:

```typescript
import { ContentiaStream } from 'contentia/core';

const program = Effect.gen(function*() {
  const { data } = yield* ContentiaStream.runCollect(
    repo.listAtoms('posts', { depth: 1, pagination: {} }),
  );
  for (const atom of data) console.log(atom.key, atom.type); // "posts/hello object"
});
```

`runCollect` holds the whole listing in memory. For a large folder, turn the listing into an Effect
`Stream` and process it item by item. A listing also carries warnings and progress events, so keep
only the data elements:

```typescript
import { ContentiaElement } from 'contentia/core';
import { Channel, Stream } from 'effect';

const atoms = Stream.fromChannel(
  Channel.mapDone(repo.listAtoms('posts', { depth: 1, pagination: {} }), () => undefined),
).pipe(
  Stream.filter(ContentiaElement.isData),
  Stream.map(element => element.value),
);

const program = atoms.pipe(Stream.runForEach(atom => Effect.log(atom.key)));
```

`Stream.fromChannel` expects a channel that ends without a value, so `Channel.mapDone` drops the
listing's `done` value. That value describes the next page; use `runCollect` when you need it.

An **atom** is anything in the tree: an object or a folder. `depth` controls how far the listing
recurses, and `pagination` accepts offset, page, or cursor (`before` / `after`) styles, depending on
what the backend supports. See [Content Model](../concepts/content-model) for the full shape.

### Recoverable warnings

Some operations partly fail but still produce a usable result, for example a listing that skipped
one corrupt file. Those come back as warnings next to the result instead of failing the Effect.
`runValue` and the `Stream` above drop them. To see them, tap the task with
[`ContentiaTask.tapRecoverableErrors`](../reference/api/contentia/core/namespaces/ContentiaTask/functions/tapRecoverableErrors),
or read `recoverableErrors` from `runCollect`:

```typescript
import type { ContentiaError } from 'contentia/core';

const logWarning = (error: ContentiaError) => Effect.logWarning(error.code, error.message);

const program = Effect.gen(function*() {
  const post = yield* ContentiaTask.runValue(
    ContentiaTask.tapRecoverableErrors(repo.getObject('posts/hello'), logWarning),
  );

  const { data, recoverableErrors } = yield* ContentiaStream.runCollect(
    repo.listAtoms('posts', { depth: 1, pagination: {} }),
  );
  for (const error of recoverableErrors) yield* logWarning(error);
});
```

Writing a repository that wraps another one? Inside your
[`ContentiaTask.make`](../reference/api/contentia/core/namespaces/ContentiaTask/functions/make)
body, drain the inner task with
[`ContentiaTask.runValueForwarding`](../reference/api/contentia/core/namespaces/ContentiaTask/functions/runValueForwarding)
or the inner stream with
[`ContentiaStream.runCollectForwarding`](../reference/api/contentia/core/namespaces/ContentiaStream/functions/runCollectForwarding),
and pass them your `emit`, so the inner warnings reach your caller.

## Swap the backend

Every backend implements the same
[`StorageRepository`](../reference/api/contentia/storage/classes/StorageRepository) interface. Put
the repository behind a service, and switching backends means providing a different `Layer`. The
program that reads and writes content stays the same:

```typescript
import type { StorageRepository } from 'contentia/storage';
import { Context, Effect, Layer } from 'effect';

class Content extends Context.Service<Content, StorageRepository>()('app/Content') {}

const readTitle = Effect.gen(function*() {
  const repo = yield* Content;
  const post = yield* ContentiaTask.runValue(repo.getObject('posts/hello'));
  return post.content.title;
});
```

::: code-group

```ts [Filesystem]
import { jsonSerializer } from 'contentia/serializers/json';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const ContentLive = Layer.succeed(
  Content,
  new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json'),
);

await Effect.runPromise(readTitle.pipe(Effect.provide(ContentLive)));
```

```ts [Cloudflare R2]
import { jsonSerializer } from 'contentia/serializers/json';
import { R2StorageRepository } from 'contentia/storage/r2';

// inside a Worker's fetch handler, where `env` holds the bucket binding
const ContentLive = Layer.succeed(
  Content,
  new R2StorageRepository(env.CONTENT_BUCKET, { json: jsonSerializer }, 'json'),
);

await Effect.runPromise(readTitle.pipe(Effect.provide(ContentLive)));
```

:::

[Adapters](../adapters/) lists every backend: git hosts, object storage, SQL databases, the
filesystem, and the browser.

<!--@include: ../.vitepress/adapters/logos.md-->

## Serve it over HTTP

[`buildJsonApi`](../reference/api/contentia/storage/api/functions/buildJsonApi) turns any storage
repository into a [JSON:API](../reference/json-api/) handler. It returns a plain
`fetch(request): Promise<Response>` function, not an Effect, so you serve it the same way with or
without Effect:

```typescript
import { serve } from '@hono/node-server';
import { allowAll } from 'contentia/json-api';
import { buildJsonApi } from 'contentia/storage/api';

const api = buildJsonApi({ repo, authorize: allowAll });
serve({ fetch: api.fetch, port: 3000 });
```

`allowAll` leaves the API open, which is only safe on a local dev server.
[Serve it over HTTP](./getting-started#serve-it-over-http) covers `authorize`, and
[Mount the API](./api-server#mount-the-api) covers the other runtimes and mounting the API in a
framework.

## Next steps

- [Repositories](../concepts/repositories): the repository pattern, and how to write your own
- [Content Model](../concepts/content-model): atoms, folders, the `body` convention, change tracking
- [Architecture](../concepts/architecture): how the storage, documents, and API layers fit together
- [Adapters](../adapters/): every supported backend
- [HTTP API](../reference/json-api/): every route and schema, plus conventions, pagination, and
  errors
- [Imports](../reference/imports): every import path and its install command
