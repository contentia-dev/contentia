# Vite

A [Vite](https://vitejs.dev) / [Rolldown](https://rolldown.rs) plugin that loads
[Contentia](https://github.com/contentia-dev/contentia) content as **ES modules** at build time.

Import content through the `contentia:` protocol and each item is read from the documents or storage
repository and emitted as a module with **one named export per field**. Because content is inlined
at build time, this is the default and primary mode: a fully static, **client-only build** — no
server, no JSON:API, nothing to deploy alongside your app. There's also an opt-in dev-server-only
"local mode" that mounts a real JSON:API for tools that need one — see [Local mode](#local-mode).

## Install

```sh
npm install -D @contentia/vite-plugin contentia
```

Requires Vite `>=8` (Rolldown-based). Works with `rolldown` directly too.

## Usage

```ts
// vite.config.ts
import { contentia } from '@contentia/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [contentia({ dir: 'content' })],
});
```

```ts
// app code — read a single document
import { $key, body, title } from 'contentia:doc/posts/hello';

// or a storage object
import site from 'contentia:store/config/site';
```

Each content item becomes a module:

```js
// contentia:doc/posts/hello
export const title = 'Hello world';
export const date = '2026-01-02';
export const body = '# Hello…';
export const $key = 'posts/hello'; // repository metadata is $-prefixed
export const $language = 'en';
export default { title, date, body };
```

Importing `{ title }` drops `body` from the bundle — the exports are independent bindings, so
Rollup/ Rolldown tree-shakes whatever you don't read.

## The `contentia:` protocol

`contentia:<namespace>/<key>` — the namespace picks the repository:

| Namespace | Repository          | Read via           |
| --------- | ------------------- | ------------------ |
| `doc`     | documents (Catalog) | `getDocument(key)` |
| `store`   | storage             | `getObject(key)`   |

The plugin also accepts longer spellings as aliases: `docs`, `document`, and `documents` all resolve
to `doc`; `storage` resolves to `store`. The canonical forms (`doc` / `store`) are what TypeScript
error messages name.

## Local mode

The `contentia:` protocol above is build-time-inline and stays the default. Separately, and off by
default, the plugin can mount Contentia's own JSON:API over its repositories while `vite dev` is
running — for a JSON:API client (e.g. the Decap admin) that needs to read and write content against
a real HTTP API in dev instead of a remote backend:

```ts
// vite.config.ts
import { contentia } from '@contentia/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [contentia({ dir: 'content', localApi: true })],
});
```

`localApi: true` mounts, under the default base path `/__contentia`:

- `/__contentia/storage` — the storage repository's JSON:API (`storage-api`'s
  [`buildJsonApi`](../reference/api/contentia/storage/api/functions/buildJsonApi))
- `/__contentia/documents` — the documents repository's JSON:API (`documents-api`'s
  [`buildJsonApi`](../reference/api/contentia/documents/api/functions/buildJsonApi))
- `/__contentia/assets` — the assets repository's JSON:API (`assets-api`'s
  [`buildAssetsApi`](../reference/api/contentia/assets/api/functions/buildAssetsApi)), so Decap
  media uploads in dev land locally
- `/__contentia/session` — a trivial stub-identity responder; local mode does no real auth, so every
  request gets the same fixed identity. It exists because `LaikaBackend.authenticate()`
  (`@contentia/server`) always pings `${apiUrl}/session` to resolve a display identity, even when
  the local backend authenticates with a dummy token.

All three repository-backed sub-APIs serve the same repositories the `contentia:` loader reads: by
default a filesystem storage repository built from `dir`, with the documents and assets repositories
derived from it via Catalog. To serve different ones, pass them through the plugin's `repositories`
option.

Pass an options object instead of `true` to override the base path:

```ts
contentia({
  dir: 'content',
  localApi: {
    // Base path the storage/documents/assets sub-routes mount under.
    // Default: '/__contentia'.
    basePath: '/__contentia',
  },
});
```

Local mode is unauthenticated by design and only ever wired up from Vite's `configureServer` hook —
nothing in the `build` phase or `configurePreviewServer` calls it, so a production build has no
route to it by construction. If the dev server isn't bound to loopback (e.g. `--host`), the plugin
logs a warning that the mounted API is reachable, unauthenticated, from the network.

[`mountLocalApi`](../reference/api/vite-plugin/functions/mountLocalApi) (and its
[`ContentiaLocalApiOptions`](../reference/api/vite-plugin/interfaces/ContentiaLocalApiOptions) type)
are also exported directly from `@contentia/vite-plugin` for callers who want to mount the same API
onto their own dev server instance rather than going through the `localApi` plugin option.

## `import.meta.glob`

Glob patterns over the protocol are expanded at build time by listing the repository — Vite's native
glob only understands filesystem paths, so this plugin rewrites `contentia:` globs itself:

```ts
// A blog index that bundles ONLY each post's title
const titles = import.meta.glob('contentia:doc/posts/*', { import: 'title', eager: true });
// → { 'contentia:doc/posts/a': 'Title A', 'contentia:doc/posts/b': 'Title B', … }

// Lazy variant — dynamic import per entry
const posts = import.meta.glob('contentia:doc/posts/*');
// → { 'contentia:doc/posts/a': () => import('contentia:doc/posts/a'), … }
```

`eager`, `import: '<field>'`, and `!`-prefixed exclusion patterns are supported. `*` matches within
a path segment; `**` matches across segments.

## TypeScript

The plugin generates types for every `contentia:` import — and it does so by handing the **real
content data to the TypeScript compiler** and letting it infer the types (no hand-written type text,
so the types can never drift from what you import). Output goes to `.contentia/vite-generated/`
(git-ignored automatically), referenced from a one-line `contentia-env.d.ts` that is scaffolded at
your project root:

```ts
// contentia-env.d.ts  (commit this)
/// <reference path="./.contentia/vite-generated/types.d.ts" />
```

Make sure your `tsconfig.json` includes it (root `*.d.ts` are included by default). Then
`import { title } from 'contentia:doc/posts/hello'` types `title` as whatever the compiler infers
from the actual file. For `import.meta.glob`, a per-collection union type is generated so you can
annotate the value type (the type file is generated into git-ignored `.contentia/vite-generated/`):

```ts
import type { Posts } from './.contentia/vite-generated/collections/posts.js';

const posts = import.meta.glob<Posts>('contentia:doc/posts/*', { eager: true });
```

## MDX bodies

A markdown-serialized item (`.md`, `.mdx`, `.markdown`) deserializes to its frontmatter fields plus
`body`, the prose. With `mdx: true` that prose is also written out as a real `.mdx` chunk under
`.contentia/vite-generated/bodies/`, and the module re-exports the compiled component as `Body`:

```ts
contentia({ dir: 'content', mdx: true });
```

```mdx
---
badge: Coming soon
heading: A hosted gateway
---

Self-install `contentia-gateway`, a multi-tenant Worker.
```

```tsx
import { badge, Body, heading } from 'contentia:store/platform';

<Body components={{ code: props => <span className="font-mono" {...props} /> }} />;
```

**This plugin never compiles MDX** and does not depend on it. It emits the chunk; pair it with a
plugin that compiles one — `@mdx-js/rollup`, ahead of your JSX plugin:

```ts
import mdx from '@mdx-js/rollup';

plugins: [
  contentia({ dir: 'content', mdx: true }),
  { enforce: 'pre', ...mdx() },
  react({ include: /\.(jsx|js|mdx|tsx|ts)$/ }),
];
```

Notes:

- The raw `body` string stays exported, and `Body` is kept **out** of the default export — importing
  the data object never drags the compiled component (or the MDX runtime) in with it.
- Chunks are `.mdx`, so bodies are MDX rather than plain CommonMark: a literal `<` or `{` in prose
  has to be escaped.
- Typing `Body` needs [`@types/mdx`](https://npm.im/@types/mdx) in your project — that is where
  `mdx/types` comes from.
- A content field literally named `Body` is an error: it would shadow this export.

## Hot reload

In `vite dev`, editing content on disk invalidates the matching `contentia:` modules and reloads the
page — including the `.mdx` chunk behind `Body`, which is rewritten before the reload is sent. This
is powered by a repository **change channel** (`StorageRepository.subscribeChanges`); the filesystem
repository implements it with a native recursive watch. Repositories without a push channel simply
don't hot-reload. Types regenerate off the same channel.

## Options

```ts
contentia({
  // Directory the default filesystem repository reads, relative to the Vite
  // project root. Default: 'content'.
  dir: 'content',

  // File extension for keys without one. Default: 'json'.
  // Recognised out of the box: .json, .yaml/.yml, .md/.mdx/.markdown, .raw.
  defaultExtension: 'json',

  // Emit each item's `body` as an .mdx chunk and export it as `Body`.
  // Default: false. Requires an MDX plugin in the chain — see "MDX bodies".
  mdx: false,

  // TypeScript declaration generation. Default: true.
  // Pass an options object for finer control:
  //   { literals: true }    — keep literal types (`'draft'`) instead of widening to `string`.
  //   { debounceMs: 30 }    — coalesce rapid incremental writes (default: 30 ms).
  typegen: true,

  // Dev-server hot reload on content change. Default: true.
  // Pass { coarse: true } to invalidate every contentia: module on any change.
  hmr: true,
  // Serializer registry for the default filesystem repository. Overrides the
  // built-in registry (.json / .yaml / .md / .raw). Ignored when `storage` or
  // `repositories` is given (supply serializers to those directly instead).
  // Default: built-in registry.
  // serializers: myRegistry,

  // Mount Contentia's JSON:API while `vite dev` runs so a JSON:API client (e.g.
  // Decap admin) can read and write content locally. Off by default.
  // See "Local mode" above for full options.
  // localApi: true,
});
```

### Bring your own repository

The filesystem repository is only the default. Pass any
[`StorageRepository`](../reference/api/contentia/storage/classes/StorageRepository) (the documents
repository is derived from it via Catalog):

```ts
import type { StorageRepository } from 'contentia/storage';

const storage: StorageRepository = /* r2, s3, webdav, drizzle, … */;
contentia({ storage });
```

To override the serializer registry for the **default filesystem repository**, pass `serializers`.
This is only relevant when you let the plugin build the FS repository from `dir` — if you supply
`storage` or `repositories`, configure serializers on those objects directly:

```ts
import { jsonSerializer } from 'contentia/serializers/json';
import { markdownSerializer } from 'contentia/serializers/markdown';

contentia({
  dir: 'content',
  serializers: { md: markdownSerializer, json: jsonSerializer },
});
```

…or derive all three repositories from your storage instance:

```ts
import { createRepositories } from '@contentia/vite-plugin';

contentia({ repositories: createRepositories(storage) });
```

## License

MIT © Sem Postma
