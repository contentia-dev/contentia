---
layout: home

hero:
  name: Contentia
  text: One content API, any backend.
  tagline: Define your content once and serve it as a JSON:API to your editors, sites and agents. The storage behind it is a configuration choice. Self-hosted, MIT licensed.
  image:
    light: /contentia-mark.svg
    dark: /contentia-mark-dark.svg
    alt: ''
  actions:
    - theme: brand
      text: Get started
      link: /guides/getting-started
    - theme: alt
      text: Adapters
      link: /adapters/
    - theme: alt
      text: GitHub
      link: https://github.com/contentia-dev/contentia

features:
  - title: You provide the domain, Contentia is the transport
    details: Model your content the way your application needs it. Contentia handles pagination, batching, streaming, discovery and warnings without hiding the details.
  - title: Swap the backend, keep the code
    details: Filesystem, R2, S3, WebDAV, SQL through Drizzle, GitHub, the browser. Every adapter implements the same repository contracts, so changing storage is configuration.
  - title: Built for editors and agents alike
    details: One JSON:API with an OpenAPI description, consumed by the Decap admin, your own UI, build-time Vite and Astro integrations, and an MCP server with a single request tool.
---

## Why Contentia

### Contentia is the transport, you provide the domain

The reason to use Contentia is that you don't want to model your domain around your CMS or storage
implementation. The goal of Contentia is to get you 90% there. Contentia attempts to not hide any
details from you, or to be opinionated about how you model your data and data retrieval. You can
read more about the architecture of Contentia [here](./concepts/architecture).

### Built for AI

Contentia is also extremely useful as a homogeneous data access layer in the age of LLMs. Contentia
provides a built-in MCP server which it feeds with the OpenAPI spec of the JSON:API. It only has one
'request' tool.

### What Contentia offers

<table>
  <tr><th colspan="2">Out of the box</th></tr>
  <tr><td>40+ official adapters</td><td>Real-time updates</td></tr>
  <tr><td>Pagination and filtering</td><td>Batch operations</td></tr>
  <tr><td>Streaming listings</td><td>Change feeds and sync tokens</td></tr>
  <tr><td>Capability discovery</td><td>Any file format</td></tr>
  <tr><td>Drafts and publishing</td><td>Revision history</td></tr>
  <tr><td>Linked assets and image variants</td><td>Conflict detection and locks</td></tr>
  <tr><td>OAuth2, passkeys and 2FA</td><td>Upload sanitization</td></tr>
  <tr><td>Astro, Vite and Decap integrations</td><td>Starters and CLI bootstrapping</td></tr>
</table>

<!--@include: ./.vitepress/adapters/logos.md-->

Contentia's core sits on top of [Effect.ts](https://effect.website/). It provides the primitives
that Contentia uses, along with some custom primitives like
[`ContentiaTask`](./reference/api/contentia/core/namespaces/ContentiaTask/) and
[`ContentiaStream`](./reference/api/contentia/core/namespaces/ContentiaStream/).

## Architecture Overview

| Layer          | Packages                                             |
| -------------- | ---------------------------------------------------- |
| API            | storage-api, documents-api, assets-api, catalog-api  |
| Domain         | storage, documents, assets, catalog                  |
| Implementation | storage-r2, storage-fs, documents-drizzle, assets-r2 |
| Shared         | core, auth, crypto, sanitizer, i18n, json-api        |

Each layer depends only on the layers below it.

## Getting Help

- **GitHub Issues** — For bugs and feature requests
- **GitHub Discussions** — For questions and discussions
- **Contributing** — See
  [CONTRIBUTING.md](https://github.com/contentia-dev/contentia/blob/develop/CONTRIBUTING.md)

## License

Contentia is [MIT licensed](https://github.com/contentia-dev/contentia/blob/develop/LICENSE).
