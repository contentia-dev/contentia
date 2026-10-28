---
title: Welcome to the Contentia blog
description: Release notes, design decisions and guides for the Contentia content API, written in the open.
date: 2026-10-07T09:00:00.000Z
author: Contentia contributors
tags:
  - announcement
---

This is where we will write about Contentia: what shipped, why an interface looks the way it does,
and how to get the most out of the content API on your own infrastructure.

## What to expect

- **Release notes** that go beyond the changelog, with the reasoning behind a change.
- **Guides** for setups that are too specific for the docs, such as a particular hosting provider or
  migrating from another tool.
- **Design notes** on the parts of Contentia we spend the most time on, like the storage contract
  and recoverable warnings.

## Written with Contentia

This blog uses the same tools it describes. Each post is a markdown file under `content/posts/` in
the website's repository, read at build time through `@contentia/astro`:

```ts
posts: defineCollection({
  loader: documentsLoader({ dir: 'content', defaultExtension: 'md', collection: 'posts' }),
}),
```

The [Astro guide](/docs/guides/astro) shows how to set up the same thing in your own site.

If there is something you would like to read about, open an
[issue](https://github.com/contentia-dev/contentia/issues) and tell us.
