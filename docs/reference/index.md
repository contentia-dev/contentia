# Reference

Exhaustive lookup material: the HTTP and TypeScript APIs, every import, the CLI, and the shared
vocabulary.

- **[HTTP API](./json-api/)** — the Storage, Documents, Assets, Catalog, and Locks API servers:
  their JSON:API conventions, pagination, and error format, and every endpoint with its parameters
  and request and response schemas.
- **[Imports](./imports)** — every import path, grouped by what it does, with its install command.
- **[CLI](./cli)** — the `contentia` command: scaffolding, a local content server, type generation,
  and migrating content between backends.
- **[Server Config](./server-config)** — `contentia serve --config`: run the Contentia API from one
  config file, with any storage backend, your own OAuth/OIDC provider, and API keys.
- **[TypeScript API](./api/)** — generated from the source and its JSDoc: classes, functions, types,
  and the [`ContentiaTask`](./api/contentia/core/namespaces/ContentiaTask/) /
  [`ContentiaStream`](./api/contentia/core/namespaces/ContentiaStream/) namespaces.
- **[Glossary](./glossary)** — terse, load-bearing definitions of protocol, repository, adapter, CMS
  integration, version, sync token, change feed, and atom/folder.
