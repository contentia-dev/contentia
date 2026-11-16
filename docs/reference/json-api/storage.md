---
title: Storage API
aside: false
outline: false
---

<script setup lang="ts">
import { useApiReference } from '../../.vitepress/theme/api-reference';
import { data } from '../examples/code-samples.data';

const OASpec = useApiReference();
</script>

# Storage API

The Storage API reads and writes a flat namespace of **atoms**: objects (structured content) and
folders, addressed by path-like keys such as `posts/hello-world`. Every operation is available two
ways: as a method on a `StorageRepository` in your Node.js code, or over HTTP, once you mount the
repository with [`buildJsonApi`](../api/contentia/storage/api/functions/buildJsonApi) from
`contentia/storage/api`. Like every Contentia API server, it requires an
[access policy](./#access-policy).

The Node.js examples call a `storage` repository; these use the filesystem one. The cURL examples
send requests to the mounted API.

::: code-group

<<< ../examples/setup.ts#setup [Node.js]

```sh [cURL]
export CONTENTIA_URL=https://cms.example.com/storage
export CONTENTIA_TOKEN=your-api-token
```

:::

**Keys in URLs.** The key is the one path segment after the resource, so a slash in a key must be
percent-encoded: `posts/hello-world` is `/objects/posts%2Fhello-world`. A URL with more segments
after the key, such as `/objects/posts/hello-world`, is rejected with 400 `invalid_data`. A trailing
slash is ignored: `GET /atoms/` is `GET /atoms`.

**Content.** An object's `content` is a JSON object, and text goes in its `body` field: a raw string
is sent as `{ "body": "…" }`, markdown with frontmatter as `{ ...frontmatter, "body": "…" }`. A
repository that stores raw files (`rawSerializer`) keeps only `body` and rejects any other field at
write time; use `jsonSerializer` for multi-field content. Every built-in backend sets `createdAt`
and `updatedAt`, though the schema marks them optional.

**Pagination.** A listing without `page[*]` parameters returns the first page of 100. The built-in
storage backends page by offset or page number only: they report `pagination.styles.cursor: false`,
so `page[after]` and `page[before]` return 400. [Conventions](./#conventions) covers the parameters.

<OASpec :spec="data.storage.spec" :tags="data.storage.tags" hide-info hide-servers hide-branding>
  <template #code-samples="{ operationId }">
    <div v-html="data.storage.samples[operationId]" />
  </template>
</OASpec>
