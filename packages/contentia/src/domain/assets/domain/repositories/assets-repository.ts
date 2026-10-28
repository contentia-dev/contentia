import type { ChangeSummary, Folder, FolderCreate, Key, SyncToken } from 'contentia/storage';

import type { ContentiaDone, ContentiaError, Pagination } from 'contentia/core';
import { ContentiaStream, ContentiaTask, InvalidData, NotImplementedError } from 'contentia/core';
import type { FilteringCapability } from 'contentia/storage';
import type {
  Asset,
  AssetCreate,
  AssetMetadata,
  AssetsCapabilities,
  AssetUpdate,
  AssetUrl,
  AssetVariations,
  Resource,
} from '../entities/index.js';

/**
 * Hints for prefetching related data.
 */
export interface FetchHints {
  variations?: boolean;
  urls?: boolean;
  metadata?: boolean;
}

export interface GetResourceOptions {
  hints?: FetchHints;
}

export interface ListResourcesOptions {
  pagination: Pagination;
  depth: number;
  hints?: FetchHints;
  /**
   * Named filter values, keyed by the wire names declared in
   * `getCapabilities().filtering.filters` (e.g. `{ search: 'logo' }`).
   * Implementations MUST fail with `InvalidData` on undeclared names rather
   * than silently ignore them — a filtered listing must never be quietly
   * unfiltered.
   */
  filters?: Readonly<Record<string, string>>;
}

export type ListResourcesDone = ContentiaDone;

export interface GetSyncTokenOptions {
  /** Scope the token to a folder; omit for the whole store. */
  folder?: string;
}

export interface ListChangesOptions {
  /** A token previously obtained from `getSyncToken` or `listChanges`. */
  since: SyncToken;
  /** Scope the feed to a folder; omit for the whole store. */
  folder?: string;
}

/**
 * Done value returned by `listChanges`. Carries the sync token that captures
 * the state of the scope after the listed changes; pass it as `since` on the
 * next call to resume the feed.
 */
export interface ListChangesDone extends ContentiaDone {
  readonly syncToken: SyncToken;
}

export interface DeleteAssetsDone extends ContentiaDone {
  readonly removed: number;
  readonly skipped: number;
}

/**
 * Validate requested `ListResourcesOptions.filters` against a declared
 * filtering capability. Returns `undefined` when every requested filter name
 * is declared (or none were requested); otherwise returns an `InvalidData`
 * error naming the offending filters. Implementations call this at the top of
 * `listResources` so undeclared filters fail loudly instead of silently
 * returning unfiltered results.
 */
export function validateListFilters(
  filters: Readonly<Record<string, string>> | undefined,
  filtering: FilteringCapability | undefined,
): ContentiaError | undefined {
  const requested = Object.keys(filters ?? {});
  if (requested.length === 0) return undefined;
  const declared = new Set(
    filtering?.supported ? filtering.filters.map(f => f.name) : [],
  );
  const unsupported = requested.filter(name => !declared.has(name));
  if (unsupported.length === 0) return undefined;
  return new InvalidData(
    `Unsupported filter(s): ${unsupported.join(', ')}. `
      + 'Consult getCapabilities().filtering for the filters this repository supports.',
  );
}

/**
 * Abstract repository for managing binary assets (images, files, media).
 *
 * Single-result operations return ContentiaTask; multi-item operations return
 * ContentiaStream with typed Done values. Recoverable errors (per-item failures
 * during bulk operations) surface via the stream's metadata channel.
 */
export abstract class AssetsRepository {
  abstract getCapabilities(): ContentiaTask.ContentiaTask<AssetsCapabilities>;

  // Resource Operations (unified endpoint)

  /**
   * Get a resource (asset or folder) by key.
   * Returns an array because a single key may resolve to multiple resources
   * (e.g. variations included via hints).
   */
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

  /**
   * Delete multiple assets. Emits each successfully-removed key as data;
   * per-key failures surface as recoverable errors.
   */
  abstract deleteAssets(keys: readonly Key[]): ContentiaStream.ContentiaStream<Key, DeleteAssetsDone>;

  /**
   * Compute variation URLs for the given assets, one entry per asset.
   * Per-asset failures (e.g. unsupported format) surface as recoverable errors.
   */
  abstract getVariations(
    assets: Asset[],
  ): ContentiaStream.ContentiaStream<AssetVariations, ContentiaDone>;

  abstract getUrls(assets: Asset[]): ContentiaStream.ContentiaStream<AssetUrl, ContentiaDone>;

  abstract getMetadata(assets: Asset[]): ContentiaStream.ContentiaStream<AssetMetadata, ContentiaDone>;

  // Folder Operations

  abstract getFolder(key: Key): ContentiaTask.ContentiaTask<Folder>;
  abstract createFolder(folderCreate: FolderCreate): ContentiaTask.ContentiaTask<Folder>;
  abstract deleteFolder(key: string, recursive?: boolean): ContentiaTask.ContentiaTask<void>;

  // Change signals (capability-gated; see AssetsCapabilities.changes)

  /**
   * Return an opaque token for the given scope (a folder, or the whole store
   * when omitted) that changes whenever anything inside the scope changes.
   * Compare tokens only by equality.
   *
   * Non-abstract on purpose: existing subclasses stay source-compatible. The
   * base implementation fails with `NotImplementedError`; check
   * `getCapabilities().changes` before calling.
   */
  getSyncToken(options?: GetSyncTokenOptions): ContentiaTask.ContentiaTask<SyncToken> {
    void options;
    return ContentiaTask.fail(
      new NotImplementedError(
        'getSyncToken is not supported by this assets repository. '
          + 'Consult getCapabilities().changes before calling.',
      ),
    );
  }

  /**
   * Enumerate what changed inside the scope since a previously obtained sync
   * token. The done value carries the new sync token to resume from.
   *
   * Non-abstract on purpose: existing subclasses stay source-compatible. The
   * base implementation fails with `NotImplementedError`; check
   * `getCapabilities().changes` before calling.
   */
  listChanges(options: ListChangesOptions): ContentiaStream.ContentiaStream<ChangeSummary, ListChangesDone> {
    void options;
    return ContentiaStream.fail(
      new NotImplementedError(
        'listChanges is not supported by this assets repository. '
          + 'Consult getCapabilities().changes before calling.',
      ),
    );
  }
}
