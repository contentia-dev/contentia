# contentia/assets

[![npm](https://img.shields.io/npm/v/contentia)](https://www.npmjs.com/package/contentia)
[![npm](https://img.shields.io/npm/dm/contentia)](https://www.npmjs.com/package/contentia)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/contentia)](https://bundlephobia.com/result?p=contentia)

Asset/media management for Contentia.

## Installation

```bash
pnpm add contentia
```

## Usage

```typescript
import { Asset, AssetCreate, AssetsRepository } from 'contentia/assets';
```

## Entities

- `Asset` - Binary file with metadata
- `AssetMetadata` - File metadata (size, mime type, etc.)
- `AssetUrl` - Signed URL for asset access

## Repository Interface

```typescript
abstract class AssetsRepository {
  abstract getCapabilities(): ContentiaTask.ContentiaTask<AssetsCapabilities>;

  // Resource Operations
  abstract getResource(
    key: string,
    options?: GetResourceOptions,
  ): ContentiaTask.ContentiaTask<ReadonlyArray<Resource>>;
  abstract listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): ContentiaStream.ContentiaStream<Resource, ListResourcesDone>;

  // Asset Operations
  abstract getAsset(key: string, options?: GetResourceOptions): ContentiaTask.ContentiaTask<Asset>;
  abstract createAsset(create: AssetCreate): ContentiaTask.ContentiaTask<Asset>;
  abstract updateAsset(update: AssetUpdate): ContentiaTask.ContentiaTask<Asset>;
  abstract deleteAsset(key: Key): ContentiaTask.ContentiaTask<void>;
  abstract deleteAssets(
    keys: readonly Key[],
  ): ContentiaStream.ContentiaStream<Key, DeleteAssetsDone>;
  abstract getVariations(
    assets: Asset[],
  ): ContentiaStream.ContentiaStream<AssetVariations, ContentiaDone>;
  abstract getUrls(assets: Asset[]): ContentiaStream.ContentiaStream<AssetUrl, ContentiaDone>;
  abstract getMetadata(
    assets: Asset[],
  ): ContentiaStream.ContentiaStream<AssetMetadata, ContentiaDone>;

  // Folder Operations
  abstract getFolder(key: Key): ContentiaTask.ContentiaTask<Folder>;
  abstract createFolder(folderCreate: FolderCreate): ContentiaTask.ContentiaTask<Folder>;
  abstract deleteFolder(key: string, recursive?: boolean): ContentiaTask.ContentiaTask<void>;

  // Change signals (capability-gated; check getCapabilities().changes before calling)
  getSyncToken(options?: GetSyncTokenOptions): ContentiaTask.ContentiaTask<SyncToken>;
  listChanges(
    options: ListChangesOptions,
  ): ContentiaStream.ContentiaStream<ChangeSummary, ListChangesDone>;
}
```

## Capabilities

`getCapabilities()` returns an `AssetsCapabilities` object with five fields:

| Field               | Description                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compatibilityDate` | Opaque version string — implementations increment this when they change behavior in a breaking way.                                                                                                                      |
| `pagination`        | Which pagination styles (`offset`, `page`, `cursor`) the repository honors on `listResources`. `supported: false` means pagination is ignored and full lists are always returned.                                        |
| `versionTracking`   | Whether the repository attaches an opaque per-record `version` token to returned assets. Tokens change only when content changes; compare by equality.                                                                   |
| `changes`           | Whether `getSyncToken` and `listChanges` are implemented. `syncToken: true` means `getSyncToken` works; `changeFeed: true` means `listChanges` works. Both default to `false` (methods fail with `NotImplementedError`). |
| `filtering`         | _(optional)_ Named filters honored by `listResources` (e.g. `search`). Absent means no filters are supported; implementations fail with `InvalidData` on undeclared filter names rather than silently ignoring them.     |

## Implementations

- `contentia/assets/r2` - Cloudflare R2
- `contentia/assets/obsidian` - Obsidian vault files (read-oriented)
- `contentia/assets/catalog` - Assets on top of a Catalog storage backend
- `contentia/assets/jsonapi-proxy` - Assets JSON:API proxy
