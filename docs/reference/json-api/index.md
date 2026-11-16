# HTTP API

Contentia serves content over HTTP as [JSON:API v1.1](https://jsonapi.org/) servers. Each server is
a `fetch(request): Promise<Response>` handler: mount it on your runtime yourself, or let
`contentia serve` mount all of them for you. All responses use the `application/vnd.api+json`
content type.

| Server                       | Default base path | Purpose                                            |
| ---------------------------- | ----------------- | -------------------------------------------------- |
| [Storage API](./storage)     | configurable      | Low-level key/value atom and folder storage        |
| [Documents API](./documents) | configurable      | Versioned content with publish/unpublish lifecycle |
| [Assets API](./assets)       | `/api/assets`     | Binary file and folder management                  |
| [Catalog API](./catalog)     | configurable      | Collection settings (document and media folders)   |
| [Locks API](./locks)         | configurable      | Advisory entry locking for admin UIs               |
| [Error Responses](./errors)  |                   | The shared error format and codes                  |

Each server's page covers its conventions, then lists every endpoint with its parameters and request
and response schemas. The list is rendered from the OpenAPI spec the server serves itself, at
`GET /openapi.json` and `GET /openapi.yaml`, so it always matches the code. The Locks API has no
spec; its page documents its endpoints by hand.

Every endpoint has a **Try it** button. It opens a request window, filled in with an example request
you can edit and send. The request goes to a Contentia instance running in your browser: the four
API servers over one
[`WebStorageRepository`](../api/contentia/storage/web/classes/WebStorageRepository) on
`sessionStorage`, with an open access policy. Nothing is sent over the network. The servers share
one store, so a document you create through the Documents API also shows up in a Storage API
listing. Your content stays in the tab until you close it or reset the sandbox from the window.

## Access policy

The Storage, Documents, Assets, and Catalog API builders all require an `authorize` callback. It
runs before every action, including the two OpenAPI routes (only `GET /`, the API's description of
itself, skips it), and receives the action descriptor plus the originating `Request`. Return `true`
to allow, `false` for a 403, or a
[`ContentiaError`](../api/contentia/core/errors/classes/ContentiaError) for a custom status.

`authorize` decides _what a caller may do_; authenticating them is still your job. Validate the
credential inside the callback, or mount the handler behind `contentia/server/api`, which checks a
Bearer token first. For a deliberately open surface, say so with
[`allowAll`](../api/contentia/json-api/functions/allowAll) from `contentia/json-api`.

## Conventions

- Single resources are returned as `{ "data": { ... } }`.
- Collections are returned as `{ "data": [ ... ], "links": { ... }, "meta": { "page": { ... } } }`.
- Errors are returned as `{ "errors": [ { "status", "code", "detail" } ] }`.
- The Documents API `/operations` endpoint is a **fail-fast batch** (not a JSON:API Atomic
  Operations extension): request body is `{ "operations": [ ... ] }`, response is
  `{ "results": [ ... ] }`. Pre-flight validates all ops before any I/O; a shape-invalid batch
  returns 400 with zero writes. A mid-batch repository failure stops processing but does not roll
  back prior ops.
- Cursor-based pagination is controlled with `page[after]` (forward) / `page[before]` (backward) and
  `page[size]` query parameters. Offset-based pagination uses `page[offset]` and `page[limit]`.
  **Cursor pagination is backend-specific.** Not all storage backends support `page[after]` /
  `page[before]`; backends like
  [`FileSystemStorageRepository`](../api/contentia/storage/fs/classes/FileSystemStorageRepository)
  and [`R2StorageRepository`](../api/contentia/storage/r2/classes/R2StorageRepository) only support
  offset- and page-based pagination. Sending a cursor param to an unsupported backend returns a
  `400 Bad Request` with a `invalid_data` error. Inspect `GET /capabilities`
  (`attributes.pagination.styles.cursor`) to confirm cursor support before using these params.
  **Page size is clamped to 1–100.** `page[size]` / `page[limit]` values outside that range are
  silently clamped into it, so a request for 500 items succeeds with 100. The response pagination
  links reflect the clamped value.
