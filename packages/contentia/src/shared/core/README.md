# contentia/core

[![npm](https://img.shields.io/npm/v/contentia)](https://www.npmjs.com/package/contentia)
[![npm](https://img.shields.io/npm/dm/contentia)](https://www.npmjs.com/package/contentia)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/contentia)](https://bundlephobia.com/result?p=contentia)

Core types, errors, and utilities for Contentia.

## Installation

```bash
pnpm add contentia
```

## Usage

```typescript
import { ContentiaError, ContentiaResult, InvalidData, NotFoundError } from 'contentia/core';
```

## Error Types

All error classes extend `ContentiaError` and carry `.status`, `.code`, and `.title` fields.

### General errors

- `NotFoundError` — Resource not found; HTTP 404
- `BadRequestError` — Duplicate key or invalid input that the caller can correct; HTTP 400
- `InvalidData` — Invalid input data; HTTP 400
- `ValidationError` — Schema / constraint validation failure; HTTP 400
- `InternalError` — Internal server error; HTTP 500
- `IllegalStateException` — Illegal internal state that should not occur; HTTP 500
- `NotImplementedError` — Feature not yet implemented; HTTP 501
- `UnknownError` — Error of unknown origin; HTTP 500

### Auth errors

- `AuthenticationError` — Not logged in; HTTP 401
- `UpstreamUnAuthorizedError` — HTTP 401; the deserialization target for a 401 challenge received
  from an **upstream** server. Not for "logged in but no permission" — use `ForbiddenError`.
- `ForbiddenError` — Logged in but lacks permissions; HTTP 403
- `AuthorizerFailureError` — API Gateway authorizer failed (infrastructure error); HTTP 500

> **Usage guidance:** use `AuthenticationError` when the user is not logged in at all (HTTP 401);
> use `ForbiddenError` when the user is logged in but lacks permissions (HTTP 403); use
> `UpstreamUnAuthorizedError` only when deserializing a 401 this server received from a remote.

### Conflict / state errors

- `EntryAlreadyExistsError` — Duplicate entry; HTTP 409
- `ConflictError` — Generic write conflict; HTTP 409
- `VersionMismatchError` — Optimistic-concurrency version conflict; HTTP 409

### Path / filesystem errors

- `DirInsteadOfFile` — Expected a file but found a directory; HTTP 403
- `FileInsteadOfDir` — Expected a directory but found a file; HTTP 403

### Rate-limit / availability errors

- `TooManyRequestsError` — Rate limit exceeded; HTTP 429
- `ServiceUnavailableError` — Upstream service unavailable; HTTP 503
- `GatewayTimeoutError` — Upstream gateway timed out; HTTP 504

### File-sanitizer errors

- `UnsupportedFileTypeError` — File type not allowed; HTTP 415
- `DangerousFileTypeError` — File type flagged as dangerous; HTTP 415
- `CorruptedFileError` — File data is corrupted; HTTP 422
- `EmbeddedContentError` — File contains disallowed embedded content; HTTP 422
- `FileTooLargeError` — File exceeds the size limit; HTTP 413

## Result Type

```typescript
type ContentiaResult<T> = Result<T, ContentiaError>;
```

Compatible with Effect's `Result` type. Use the `contentia/compat` helpers (`runTask`,
`collectStream`) to consume tasks/streams without importing Effect directly.

## Compat helpers (`contentia/compat`)

Promise wrappers for `ContentiaTask` and `ContentiaStream` — no `effect` import needed at the call
site.

```typescript
import { collectStream, runTask } from 'contentia/compat';

// Run a ContentiaTask to completion — resolves with the value or rejects with a ContentiaError
const object = await runTask(repository.getObject(key));

// Collect all data items from a ContentiaStream — resolves with { items, done }
// `offset` is required for offset-style pagination; `{ limit: 100 }` alone would silently return the full list.
// `Pagination` is a union of PaginationOffsetSchema, PaginationPageBasedSchema, PaginationBeforeSchema, PaginationAfterSchema.
const { items, done } = await collectStream(
  repository.listAtoms(folderKey, { depth: 1, pagination: { offset: 0, limit: 100 } }),
);
console.log(items); // Atom[]
```

## Subpath exports

| Subpath                       | Description                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `contentia/core`              | Types, errors, and utilities (main barrel)                                                                                  |
| `contentia/core/errors`       | Domain error classes (`ContentiaError` subclasses: `NotFoundError`, `BadRequestError`, `InternalError`, etc.)               |
| `contentia/core/errors-extra` | HTTP adapter utilities: `ErrorCodeToStatusMap`, `ErrorCodeToKeyMap`, `ErrorClasses`                                         |
| `contentia/core/types/*`      | Targeted type modules: `datetime`, `effect`, `ext-name`, `mime-type`, `pagination`, `role`, `role-permission`               |
| `contentia/core/utilities`    | Dependency-free helpers — safe for bundled consumers that must not pull in Effect or the contentia domain graph (see below) |

### `contentia/core/utilities`

Zero-dependency helpers exported as a separate subpath so bundled consumers (e.g. edge workers) can
use them without importing Effect or any part of the contentia domain graph.

```typescript
import {
  Header,
  lazy,
  lazyAsync,
  memoize,
  Paths,
  TemplateLiteral,
  Url,
} from 'contentia/core/utilities';

// Single-item memoize (keeps last result only — no unbounded cache growth)
const expensiveFn = memoize((id: string) => computeSomething(id));

// Lazy singleton — initialised on first call
const getConfig = lazy(() => loadConfig());

// Lazy async singleton
const getDb = lazyAsync(() => connectToDatabase());

// URL helpers
Url.join('/api', '/users'); // '/api/users'
Url.isAbsolute('https://example.com'); // true
Url.combine('/a', '/b', '/c'); // '/a/b/c'

// Path helpers
Paths.toSegments('foo/bar/baz'); // ['foo', 'bar', 'baz']
Paths.combine('foo', 'bar', 'baz'); // 'foo/bar/baz'

// Authorization header helpers
Header.ExtractAuthorizationBearerToken('Bearer abc123'); // 'abc123'
Header.ExtractAuthorizationApiKey('ApiKey mykey'); // 'mykey'

// Tagged template for URL construction
const url = TemplateLiteral.url`/api/${'users'}/${'123'}`; // '/api/users/123'
```
