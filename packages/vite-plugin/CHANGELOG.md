# @contentia/vite-plugin

## 6.0.0

### Major Changes

- e8ab49b: Rename ContentBase to Catalog, and move its storage layout under `.contentia/`.

  "ContentBase" named the opinionated layer of the protocol — the named document and media
  collections projected onto generic atoms and folders — but read like a product name and said
  nothing about collections. Worse, the JSON:API it serves already spoke a different word for the
  same thing (`/collections`, `document-collection`, `media-collection`), so the codebase carried
  two vocabularies for one concept. It is now the **catalog**: a catalog contains collections.

  Subpath exports:

  | before                                   | after                          |
  | ---------------------------------------- | ------------------------------ |
  | `contentia/contentbase-settings`         | `contentia/catalog`            |
  | `contentia/contentbase-api`              | `contentia/catalog-api`        |
  | `contentia/documents/contentbase`        | `contentia/documents/catalog`  |
  | `contentia/assets/contentbase`           | `contentia/assets/catalog`     |
  | `contentia/contentbase-settings-default` | `contentia/catalog-convention` |
  | `contentia/contentbase-settings-decap`   | `contentia/catalog-decap`      |

  Identifiers: `ContentBaseSettingsProvider` → `CatalogProvider`, `ContentBaseSettings` → `Catalog`,
  `DefaultContentBaseSettingsProvider` → `ConventionCatalogProvider`,
  `DecapContentBaseSettingsProvider` → `DecapCatalogProvider`, `ContentBaseDocumentsRepository` →
  `CatalogDocumentsRepository`, `ContentBaseAssetsRepository` → `CatalogAssetsRepository`,
  `buildContentbaseOpenApi` → `buildCatalogOpenApi`. On `CatalogProvider`,
  `getSettings`/`putSettings` are now `getCatalog`/`putCatalog` — the per-collection accessors are
  unchanged. The JSON:API wire format does not change: resource types stay
  `document-collection`/`media-collection` and the routes stay `/collections`.

  `contentia/catalog-convention` now persists to `.contentia/catalog`,
  `.contentia/schemas/<collection>` and `.contentia/revisions/<collection>` instead of
  `.contentbase/…`. Keys stay extensionless so the storage repository's configured serializers
  decide the format. Where a catalog lives is the provider's business, not the contract's —
  `catalog-decap` still reads its `configKey` object, and a database provider has no path at all.

  `@contentia/vite-plugin` moves its generated output from `.contentia/` to
  `.contentia/vite-generated/`, so the two lifecycles no longer share a directory: everything
  directly under `.contentia/` is durable state that belongs in git, and only `vite-generated/` is
  ignored. The plugin now appends `.contentia/vite-generated/` to the project `.gitignore` (not
  `.contentia/`) and writes `vite-generated/` into `.contentia/.gitignore`. Update the reference in
  your committed `contentia-env.d.ts`:

  ```ts
  /// <reference path="./.contentia/vite-generated/types.d.ts" />
  ```

  A project that previously had a bare `.contentia/` rule in `.gitignore` must narrow it, or its
  catalog will never be committed.

- e8ab49b: Require an explicit `authorize` policy on every JSON:API handler, and authorize the
  OpenAPI routes.

  `authorize` was optional on `buildJsonApi` (storage, documents, catalog) and `buildAssetsApi`, and
  omitting it meant "allow every caller everything". A security-critical default that you get by
  _not_ typing something is the wrong shape: the handler that reads, mutates, and deletes all your
  content was one forgotten option away from being wide open, and nothing in the type system said
  so. `@contentia/server`'s `contentiaApi` already required its policy — the four raw handlers were
  the inconsistency.

  `authorize` is now a **required** option on all four:

  ```typescript
  const api = buildJsonApi({
    repo,
    authorize: async ({ action, request }) => {
      const user = await myAuth(request);
      if (!user) return new AuthenticationError('Missing token'); // → 401
      return user.isAdmin || action === 'readOpenApi'; // false → 403
    },
  });
  ```

  For a surface that is deliberately open — a dev server on loopback, a test harness, or a handler
  already behind an authenticating proxy — state that explicitly with the new `allowAll` export from
  `contentia/json-api`:

  ```typescript
  import { allowAll } from 'contentia/json-api';

  const api = buildJsonApi({ repo, authorize: allowAll });
  ```

  Naming it rather than inlining `() => true` means every intentionally-open surface in a deployment
  is one `rg 'authorize: allowAll'` away during an audit.

  `GET /openapi.json` and `GET /openapi.yaml` are now authorized like every other action, via a new
  `{ action: 'readOpenApi', format: 'json' | 'yaml' }` variant on each API's action union.
  Previously they were served unconditionally, so a deny-all policy still handed out the full schema
  shape. A policy that wants a public spec alongside a private API allows that one action:

  ```typescript
  authorize: ({ action }) => action === 'readOpenApi' ? true : checkToken(...)
  ```

  `AuthorizeDecision` and `resolveAuthorization` moved to `contentia/json-api` and are now publicly
  exported — `AuthorizeDecision` appears in the signature of every `*Authorize` callback type but
  was previously unnameable by consumers.

  `@contentia/vite-plugin`'s local dev API and `@contentia/server`'s inner handlers pass `allowAll`
  (the vite dev server is loopback-guarded; `contentiaApi` authenticates and applies its own
  `authorize` gate before dispatching), so neither changes behaviour.

### Patch Changes

- Updated dependencies [e8ab49b]
- Updated dependencies [14df4cf]
- Updated dependencies [387a1b4]
- Updated dependencies [06b4a5a]
- Updated dependencies [e8ab49b]
- Updated dependencies [14df4cf]
- Updated dependencies [e8ab49b]
- Updated dependencies [6b918c6]
  - contentia@6.0.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f17498]
- Updated dependencies [2f17498]
- Updated dependencies [2f17498]
  - contentia@5.0.0

## 3.1.0

### Minor Changes

- Complete the local-mode content API: the opt-in JSON:API served over the Vite dev server now
  covers the full content surface, including mounting the assets JSON:API when one is supplied.

### Patch Changes

- Await generated type writes in the plugin so type generation completes before the dev server
  continues.
- Updated dependencies
- Updated dependencies
  - contentia@3.1.0

## 3.0.1

### Patch Changes

- contentia@3.0.1

## 3.0.0

### Minor Changes

- d26bdfe: New package `@contentia/vite-plugin`: a Vite/Rolldown plugin that loads Contentia content
  as ES modules at build time via a `contentia:` import protocol (`contentia:doc/<key>`,
  `contentia:store/<key>`). Each item is read from the documents or storage repository and emitted
  with one named export per field for tree-shaking; `import.meta.glob('contentia:…')` is expanded by
  listing the repository (via `es-module-lexer` + `magic-string`, with sourcemaps). Because content
  is inlined at build time it works in a fully static, client-only build — no server, no JSON:API.
  Ships two more capabilities: TypeScript IntelliSense generated by running the TypeScript compiler
  over the real content data (so the compiler infers the types — zero drift), written to
  `.contentia/` + a committed `contentia-env.d.ts`; and dev-server hot reload driven by a new
  repository change channel.

  `contentia` gains that change-channel primitive: `StorageRepository.subscribeChanges` plus a
  `changes` capability on the storage `Capabilities`. The base implementation is a no-op
  (`unsupportedChanges`); the filesystem repository implements a real push channel over a native
  recursive watch. Existing storage implementations advertise `changes: unsupportedChanges`.

- d26bdfe: New `mdx` option. A markdown-serialized item deserializes to its frontmatter fields plus
  `body`; with `mdx: true` that prose is also written out as a real `.mdx` chunk under
  `.contentia/bodies/` and the generated module re-exports the compiled component as `Body`,
  alongside the raw `body` string. The plugin never compiles MDX and takes no dependency on it — the
  chunk is an ordinary file, so `@mdx-js/rollup` (or anything else keyed on the extension) handles
  it. A file on disk is required rather than a second virtual module: `createFilter` from
  `@rollup/pluginutils` rejects ids containing a NUL byte, so extension-driven plugins can never see
  a `\0contentia:…` id. `Body` is deliberately kept out of the default export, so importing the data
  object does not pull the MDX runtime in with it, and a content field named `Body` is rejected
  rather than silently shadowed. Chunks are rewritten and invalidated ahead of the reload in dev,
  and pruned at the start of every build.

  The default serializer registry — which is keyed by file extension — also gains `.md`, `.mdx` and
  `.yml`, so those files are readable at all.

### Patch Changes

- d26bdfe: `import.meta.glob('contentia:…')` now works in `.tsx`/`.jsx` modules. The glob rewrite
  runs as a `pre` transform (before JSX is stripped) and located `import.meta` tokens with
  es-module-lexer, which cannot parse JSX and threw — failing the whole build for any component that
  reached for a `contentia:` glob. When the lexer can't parse a module, the plugin now falls back to
  scanning a copy of the source with strings and comments masked out, which still finds real
  `import.meta.glob(...)` calls while ignoring any `contentia:` occurrence inside a string or
  comment.
- Updated dependencies [68c658f]
- Updated dependencies [d26bdfe]
  - contentia@3.0.0

## 2.2.0

### Minor Changes

- Initial release. A Vite/Rolldown plugin that loads Contentia content as ES modules at build time
  via a `contentia:` import protocol (`contentia:doc/<key>`, `contentia:store/<key>`). Each item is
  read from the documents or storage repository and emitted with one named export per field for
  tree-shaking, and `import.meta.glob('contentia:…')` is expanded by listing the repository (via
  `es-module-lexer` + `magic-string`, with sourcemaps). Because content is inlined at build time it
  works in a fully static, client-only build — no server, no JSON:API.

  Also includes:
  - **TypeScript IntelliSense** generated by running the TypeScript compiler over the real content
    data, so the compiler infers the types (zero drift). Written to `.contentia/` + a committed
    `contentia-env.d.ts`; per-collection union aliases type `import.meta.glob`.
  - **Hot reload** in `vite dev`, driven by the new `StorageRepository.subscribeChanges` change
    channel (the filesystem repository implements it over a native recursive watch).

  A filesystem repository rooted at `content/` is the default backend.
