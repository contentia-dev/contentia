# contentia/storage

[![npm](https://img.shields.io/npm/v/contentia)](https://www.npmjs.com/package/contentia)
[![npm](https://img.shields.io/npm/dm/contentia)](https://www.npmjs.com/package/contentia)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/contentia)](https://bundlephobia.com/result?p=contentia)

Core storage abstractions for Contentia.

## Installation

```bash
pnpm add contentia
```

## Usage

```typescript
import { Atom, StorageObject, StorageRepository } from 'contentia/storage';
```

## Return types

Methods return one of two effect types from `contentia/core`:

- `ContentiaTask.ContentiaTask<T>` — resolves to a single value (async, like a Promise)
- `ContentiaStream.ContentiaStream<T, Done>` — emits multiple values and then a done value
  (streaming)

## Entities

- `StorageObject` - A stored object with key and content
- `StorageObjectCreate` - Input type for creating a storage object
- `StorageObjectUpdate` - Input type for updating a storage object
- `Atom` - Generic storage item (object or folder)
- `AtomSummary` - Lightweight summary of an atom, used when listing
- `Folder` - A container for atoms
- `FolderCreate` - Input type for creating a folder
- `Capabilities` - Describes what the storage backend supports
- `ListAtomsDone` - Type alias for `ContentiaDone`; inherits pagination and total from the base
  interface
- `RemoveAtomsDone` - Done value returned by `removeAtoms`; includes `removed` and `skipped` counts

## Repository Interface

```typescript
abstract class StorageRepository {
  // Storage Objects (formerly Files)
  abstract getObject(key: Key): ContentiaTask.ContentiaTask<StorageObject>;
  abstract createObject(create: StorageObjectCreate): ContentiaTask.ContentiaTask<StorageObject>;
  abstract updateObject(update: StorageObjectUpdate): ContentiaTask.ContentiaTask<StorageObject>;
  abstract createOrUpdateObject(
    create: StorageObjectCreate,
  ): ContentiaTask.ContentiaTask<StorageObject>;

  // Folders (formerly Directories)
  abstract getFolder(key: Key): ContentiaTask.ContentiaTask<Folder>;
  abstract createFolder(folderCreate: FolderCreate): ContentiaTask.ContentiaTask<Folder>;
  abstract listAtomSummaries(
    folderKey: Key,
    options: ListAtomsOptions,
  ): ContentiaStream.ContentiaStream<AtomSummary, ListAtomsDone>;
  abstract listAtoms(
    folderKey: Key,
    options: ListAtomsOptions,
  ): ContentiaStream.ContentiaStream<Atom, ListAtomsDone>;

  // Atoms (formerly Entries)
  abstract getAtom(key: Key): ContentiaTask.ContentiaTask<Atom>;
  abstract removeAtoms(keys: readonly Key[]): ContentiaStream.ContentiaStream<Key, RemoveAtomsDone>;

  // Other
  abstract getCapabilities(): ContentiaTask.ContentiaTask<Capabilities>;
}
```

## Ignore lists

Storage repositories take an `ignoreList` of glob patterns and leave matching paths out of listings
(and out of change notifications, where the backend has them). Patterns are matched against the path
from the repository root, such as `posts/.keep`.

- `*` matches any run of characters within one path segment, including none.
- `?` matches exactly one character within one path segment.
- `**` as a whole segment matches zero or more segments: `**/.keep` matches `.keep` and `a/b/.keep`,
  and `drafts/**` matches `drafts` and everything under it. Inside a longer segment it acts as `*`.
- `{a,b}` matches any of its comma-separated alternatives, as in `**/*.{tmp,bak}`.
- `\` makes the next character literal: `\*.md` matches a file named `*.md`.

Wildcards match dotfiles, and matching is case-sensitive. Leading, trailing, and repeated `/` are
ignored, so `/drafts/` is the same pattern as `drafts`. Blank patterns and patterns starting with
`#` are skipped.

Character classes (`[abc]`), extglobs (`@(a|b)`), brace ranges (`{1..3}`), nested braces, and
negation (`!pattern`) are not supported. A repository throws when it's constructed with a pattern
that uses them, rather than matching it some other way. One pattern's `{a,b}` groups can expand to
at most 256 patterns.

Matching doesn't use regular expressions and takes at most O(pattern × path) steps, so no pattern
can make it backtrack exponentially.

To filter paths the same way in your own `StorageRepository`, use `compileIgnoreList`:

```typescript
import { compileIgnoreList } from 'contentia/storage';

const isIgnored = compileIgnoreList(['**/.keep', '**/.DS_Store']);
isIgnored('posts/.keep'); // true
isIgnored('posts/hello.md'); // false
```

## Implementations

- `contentia/storage/r2` - Cloudflare R2
- `contentia/storage/fs` - Local filesystem
- `contentia/storage/drizzle` - SQL via Drizzle ORM
- `contentia/storage/s3` - Any S3-compatible object store (AWS S3, MinIO, B2, R2 over S3, …)
- `contentia/storage/webdav` - WebDAV server
- `contentia/storage/jsonapi-proxy` - Storage JSON:API proxy
- `contentia/storage/web-fs` - Browser File System API (any directory handle: origin-private or
  user-picked)
