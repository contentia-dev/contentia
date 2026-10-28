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

## Implementations

- `contentia/storage/r2` - Cloudflare R2
- `contentia/storage/fs` - Local filesystem
- `contentia/storage/drizzle` - SQL via Drizzle ORM
- `contentia/storage/s3` - S3→R2Bucket adapter (pairs with `R2StorageRepository`)
- `contentia/storage/webdav` - WebDAV server
- `contentia/storage/jsonapi-proxy` - Storage JSON:API proxy
- `contentia/storage/web-fs` - Browser File System API (any directory handle: origin-private or
  user-picked)
