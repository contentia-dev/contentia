---
layout: home
title: Contentia
titleTemplate: One content API, any backend
---

<script setup>
import BackendMarquee from './.vitepress/theme/home/BackendMarquee.vue'
import BackendSwitch from './.vitepress/theme/home/BackendSwitch.vue'
import HomeHero from './.vitepress/theme/home/HomeHero.vue'
import SetupDiagrams from './.vitepress/theme/home/SetupDiagrams.vue'

// Kept here, not as attributes: Markdown only treats a component tag as HTML when the whole opening
// tag sits on one line, so a multi-line <HomeHero ...> gets reflowed as a paragraph by the formatter.
const hero = {
  title: 'One content API.',
  accent: 'Any backend.',
  tagline: 'Contentia is a unified API for content delivery and content management. Whether you want to prevent vendor lock-in, combine all your different datasources into one API or you want a stable foundation, Contentia is your pick.',
  install: 'pnpm add contentia',
  actions: [
    { text: 'Get started', link: '/guides/getting-started', theme: 'brand' },
    { text: 'GitHub', link: 'https://github.com/contentia-dev/contentia' },
  ],
  runtimes: ['Node', 'Bun', 'Deno', 'Cloudflare Workers', 'Browser'],
}
</script>

<HomeHero v-bind="hero">

<BackendSwitch file="content.ts">

::: code-group

```ts{2,4} [Filesystem]
import { jsonSerializer as json } from 'contentia/serializers/json';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

const repo = new FileSystemStorageRepository('./content', { json }, 'json');

// the same calls on every backend
await repo.createOrUpdateObject({
  key: 'posts/hello',
  content: { title: 'Hello' },
});

const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
// [{ key: 'posts/hello', type: 'object', … }]
```

```ts{2,3,5,7,8,17-19} [Cloudflare R2]
import { jsonSerializer as json } from 'contentia/serializers/json';
import { env } from 'cloudflare:workers';
import { R2StorageRepository } from 'contentia/storage/r2';

const repo = new R2StorageRepository(env.CONTENT, { json }, 'json');

export default {
  async fetch() {
    // the same calls on every backend
    await repo.createOrUpdateObject({
      key: 'posts/hello',
      content: { title: 'Hello' },
    });

    const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
    // [{ key: 'posts/hello', type: 'object', … }]
    return Response.json(items);
  },
};
```

```ts{2,3,5-12} [GitHub]
import { jsonSerializer as json } from 'contentia/serializers/json';
import { Octokit } from '@octokit/rest';
import { GithubStorageRepository } from 'contentia/storage/github';

const repo = new GithubStorageRepository({
  owner: 'acme',
  repo: 'content',
  branch: 'main',
  octokit: new Octokit({ auth: process.env.GITHUB_TOKEN }),
  serializerRegistry: { json },
  defaultFileExtension: 'json',
});

// the same calls on every backend
await repo.createOrUpdateObject({
  key: 'posts/hello',
  content: { title: 'Hello' },
});

const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
// [{ key: 'posts/hello', type: 'object', … }]
```

```ts{2,4-11} [WebDAV]
import { jsonSerializer as json } from 'contentia/serializers/json';
import { WebDavStorageRepository } from 'contentia/storage/webdav';

const repo = new WebDavStorageRepository(
  {
    baseUrl: 'https://dav.example.com/content',
    auth: { username: 'alice', password: process.env.DAV_PASSWORD },
  },
  { json },
  'json',
);

// the same calls on every backend
await repo.createOrUpdateObject({
  key: 'posts/hello',
  content: { title: 'Hello' },
});

const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
// [{ key: 'posts/hello', type: 'object', … }]
```

```ts{2,4-7} [Web Storage]
import { jsonSerializer as json } from 'contentia/serializers/json';
import { WebStorageRepository } from 'contentia/storage/web';

const repo = new WebStorageRepository({
  serializerRegistry: { json },
  defaultExtension: 'json',
});

// the same calls on every backend
await repo.createOrUpdateObject({
  key: 'posts/hello',
  content: { title: 'Hello' },
});

const { items } = await repo.listAtoms('posts', { depth: 1, pagination: {} }).collect();
// [{ key: 'posts/hello', type: 'object', … }]
```

:::

</BackendSwitch>

</HomeHero>

<BackendMarquee />

## How it fits

Contentia uses an advanced 2 way communication system which allows capability sharing between
backends. Which is how Git, databases, and external API services are able to share a single
interface while keeping their individual advantages like revisions, real-time updates, locking,
streaming, pagination, batching, etc.

<SetupDiagrams />

## Next

- **[Get started](/guides/getting-started)**: read, write and serve content in a few lines.
- **[History](/history)**: where Contentia comes from.
- **[Adapters](/adapters/)**: every backend, with its options.
