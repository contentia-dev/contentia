import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  type Asset,
  type AssetCreate,
  type AssetMetadata,
  type AssetMetadataContent,
  type AssetsCapabilities,
  AssetsCompatibilityDate,
  AssetsRepository,
  type AssetUpdate,
  type AssetUrl,
  type AssetVariation,
  type AssetVariations,
  type DeleteAssetsDone,
  type GetResourceOptions,
  type ListResourcesDone,
  type ListResourcesOptions,
  type Resource,
  validateListFilters,
} from 'contentia/assets';
import type { CatalogProvider, MediaCollectionSettings } from 'contentia/catalog';
import type { ContentiaDone, ContentiaError } from 'contentia/core';
import { BadRequestError, ContentiaStream, ContentiaTask, EntryAlreadyExistsError } from 'contentia/core';
import type { Atom, Folder, FolderCreate, StorageRepository } from 'contentia/storage';
import { pathCombine, pathToSegments } from 'contentia/storage';

/** Lift a ContentiaTask into an Effect, forwarding metadata to the outer emit. */
const runForwarding = <A>(
  task: ContentiaTask.ContentiaTask<A>,
  emit: ContentiaTask.ContentiaMetadataEmit,
): Effect.Effect<A, ContentiaError> => ContentiaTask.runValueForwarding(task, emit);

/** Encode a Uint8Array to a base64 string. Works in Node and Workers (no Buffer dep). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** Drain a BinaryContent into a single Uint8Array. */
async function consumeBinary(
  content: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);

  const reader = content.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Catalog-backed AssetsRepository.
 *
 * Asset binary content is persisted through a `StorageRepository` by encoding the bytes
 * as base64 inside a `StorageObjectContent` payload (alongside `mimeType`, `size`, and
 * optional metadata). Logical asset keys are `<collection>/<rest>`.
 */
export class CatalogAssetsRepository extends AssetsRepository {
  private readonly createVariationsFn?: (key: string) => Record<string, AssetVariation>;

  constructor(
    private readonly storageRepository: StorageRepository,
    private readonly settingsProvider: CatalogProvider,
    options?: {
      createVariations?: (key: string) => Record<string, AssetVariation>,
    },
  ) {
    super();
    this.createVariationsFn = options?.createVariations;
  }

  getCapabilities(): ContentiaTask.ContentiaTask<AssetsCapabilities> {
    return ContentiaTask.make<AssetsCapabilities>(emit =>
      Effect.gen({ self: this }, function*() {
        const caps = yield* ContentiaTask.runValueForwarding(this.storageRepository.getCapabilities(), emit);
        return {
          compatibilityDate: AssetsCompatibilityDate.make('2026-05-11'),
          pagination: caps.pagination,
          versionTracking: {
            supported: false,
            description: 'The underlying storage repository does not expose version tokens.',
          },
          changes: {
            supported: false,
            description: 'The underlying storage repository does not expose a change feed.',
          },
          filtering: {
            supported: false,
            description: 'The underlying storage repository does not support listing filters.',
          },
        };
      })
    );
  }

  /** Split a logical key into its collection prefix and the remainder. */
  private parseKey(key: string): { collection: string, remainder: string } {
    const segments = pathToSegments(key);
    if (segments.length === 0) return { collection: '', remainder: '' };
    const [collection, ...rest] = segments;
    return { collection, remainder: rest.length > 0 ? pathCombine(...rest) : '' };
  }

  /** Resolve a collection name to its underlying directory and settings. */
  private resolveCollection(
    collection: string,
    emit: ContentiaTask.ContentiaMetadataEmit,
  ): Effect.Effect<{ directory: string, settings: MediaCollectionSettings }, ContentiaError> {
    return Effect.gen({ self: this }, function*() {
      const settings = yield* runForwarding(this.settingsProvider.getMediaCollectionSettings(collection), emit);
      const directory = settings.directory ?? collection;
      return { directory, settings };
    });
  }

  /** Resolve a logical asset key to its physical storage path plus collection settings. */
  private getAssetPath(
    key: string,
    emit: ContentiaTask.ContentiaMetadataEmit,
  ): Effect.Effect<
    {
      physical: string,
      directory: string,
      collection: string,
      settings: MediaCollectionSettings,
    },
    ContentiaError
  > {
    return Effect.gen({ self: this }, function*() {
      const { collection, remainder } = this.parseKey(key);
      if (!collection) {
        return yield* Effect.fail(new BadRequestError(`Asset key '${key}' is missing a collection prefix`));
      }
      const { directory, settings } = yield* this.resolveCollection(collection, emit);
      const physical = remainder ? pathCombine(directory, remainder) : directory;
      return { physical, directory, collection, settings };
    });
  }

  /** Convert a physical storage path back to a logical key. */
  private extractKeyFromPath(fullPath: string, directory: string, collection: string): string {
    const physSegments = pathToSegments(fullPath);
    const dirSegments = pathToSegments(directory);
    let stripped = physSegments;
    if (
      dirSegments.length <= physSegments.length
      && dirSegments.every((segment, i) => segment === physSegments[i])
    ) {
      stripped = physSegments.slice(dirSegments.length);
    }
    return stripped.length > 0 ? pathCombine(collection, ...stripped) : collection;
  }

  /** Render a `MediaCollectionSettings.url` template against an asset key. */
  private renderUrlTemplate(template: string, logicalKey: string): string {
    const segments = pathToSegments(logicalKey);
    const filename = segments.length > 0 ? segments[segments.length - 1]! : logicalKey;
    return template
      .replace(/\{key\}/g, logicalKey)
      .replace(/\{filename\}/g, filename)
      .replace(/\{path\}/g, logicalKey);
  }

  /** Build the public-facing asset content payload, stripping the base64 binary. */
  private toAssetContent(content: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {
      size: typeof content.size === 'number' ? content.size : 0,
      contentType: typeof content.mimeType === 'string' ? content.mimeType : 'application/octet-stream',
    };
    if (content.customMetadata && typeof content.customMetadata === 'object') {
      result.customMetadata = content.customMetadata;
    }
    return result;
  }

  private atomToResource(atom: Atom, directory: string, collection: string): Resource {
    const logicalKey = this.extractKeyFromPath(atom.key, directory, collection);
    if (atom.type === 'folder') {
      return { ...atom, key: logicalKey };
    }
    return {
      type: 'asset',
      key: logicalKey,
      createdAt: atom.createdAt,
      updatedAt: atom.updatedAt,
      content: this.toAssetContent(atom.content),
    };
  }

  // ===== Resource Operations =====

  getResource(
    key: string,
    _options?: GetResourceOptions,
  ): ContentiaTask.ContentiaTask<ReadonlyArray<Resource>> {
    return ContentiaTask.make<ReadonlyArray<Resource>>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getAssetPath(key, emit);
        const atom = yield* ContentiaTask.runValueForwarding(this.storageRepository.getAtom(path.physical), emit);
        return [this.atomToResource(atom, path.directory, path.collection)];
      })
    );
  }

  listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): ContentiaStream.ContentiaStream<Resource, ListResourcesDone> {
    return ContentiaStream.make<Resource, ListResourcesDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const filterError = validateListFilters(options.filters, undefined);
        if (filterError) {
          return yield* Effect.fail(filterError);
        }
        const { collection, remainder } = this.parseKey(folderKey);
        if (!collection) {
          // Root/empty folder key has no collection prefix — Catalog cannot enumerate
          // all collections, so return an empty list. Decap admin queries without
          // filter[folder] on every Media tab open; 400 would break it unconditionally.
          return { total: 0 };
        }
        const resolved = yield* this.resolveCollection(collection, emit);
        const physicalFolder = remainder ? pathCombine(resolved.directory, remainder) : resolved.directory;

        // Use listAtoms (not listAtomSummaries) so each entry carries its full
        // StorageObjectContent — summaries alone can't report a listed asset's
        // contentType, which regressed to `null` (LCMS-271).
        const { data: atoms, done: storageDone } = yield* ContentiaStream.runCollectForwarding(
          this.storageRepository.listAtoms(physicalFolder, {
            pagination: options.pagination,
            depth: options.depth,
          }),
          emit,
        );

        for (const atom of atoms) {
          yield* emit.data(this.atomToResource(atom, resolved.directory, collection));
        }
        return {
          total: storageDone.total ?? atoms.length,
          ...(storageDone.pagination ? { pagination: storageDone.pagination } : {}),
        };
      })
    );
  }

  // ===== Asset Operations =====

  getAsset(key: string, _options?: GetResourceOptions): ContentiaTask.ContentiaTask<Asset> {
    return ContentiaTask.make<Asset>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getAssetPath(key, emit);
        const obj = yield* ContentiaTask.runValueForwarding(this.storageRepository.getObject(path.physical), emit);
        return {
          type: 'asset',
          key,
          createdAt: obj.createdAt,
          updatedAt: obj.updatedAt,
          content: this.toAssetContent(obj.content),
        } satisfies Asset;
      })
    );
  }

  createAsset(create: AssetCreate): ContentiaTask.ContentiaTask<Asset> {
    return ContentiaTask.make<Asset>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getAssetPath(create.key, emit);
        if (
          path.settings.accept && path.settings.accept.length > 0
          && !path.settings.accept.includes(create.mimeType)
        ) {
          return yield* Effect.fail(
            new BadRequestError(
              `MIME type '${create.mimeType}' is not allowed in collection '${path.settings.key}'. `
                + `Allowed: ${path.settings.accept.join(', ')}`,
            ),
          );
        }

        const bytes = yield* Effect.promise(() => consumeBinary(create.content));
        const storedContent: Record<string, unknown> = {
          data: bytesToBase64(bytes),
          mimeType: create.mimeType,
          size: bytes.byteLength,
        };
        if (create.filename) storedContent.filename = create.filename;
        if (create.customMetadata) storedContent.customMetadata = create.customMetadata;
        if (create.cacheControl) storedContent.cacheControl = create.cacheControl;

        const result = yield* ContentiaTask.runValueForwarding(
          this.storageRepository.createObject({
            type: 'object',
            key: path.physical,
            content: storedContent,
          }),
          emit,
        ).pipe(
          Effect.mapError(e =>
            e instanceof EntryAlreadyExistsError
              ? new EntryAlreadyExistsError(`Already exists: ${create.key}`)
              : e
          ),
        );
        return {
          type: 'asset',
          key: create.key,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          content: this.toAssetContent(storedContent),
        };
      })
    );
  }

  updateAsset(update: AssetUpdate): ContentiaTask.ContentiaTask<Asset> {
    return ContentiaTask.make<Asset>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getAssetPath(update.key, emit);
        const existing = yield* ContentiaTask.runValueForwarding(this.storageRepository.getObject(path.physical), emit);
        const merged: Record<string, unknown> = { ...existing.content };
        if (update.mimeType) merged.mimeType = update.mimeType;
        if (update.cacheControl) merged.cacheControl = update.cacheControl;
        if (update.customMetadata) merged.customMetadata = update.customMetadata;

        const result = yield* ContentiaTask.runValueForwarding(
          this.storageRepository.updateObject({
            key: path.physical,
            content: merged,
          }),
          emit,
        );
        return {
          type: 'asset',
          key: update.key,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          content: this.toAssetContent(merged),
        };
      })
    );
  }

  deleteAsset(key: string): ContentiaTask.ContentiaTask<void> {
    return ContentiaTask.make<void>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getAssetPath(key, emit);
        yield* Effect.map(
          ContentiaStream.runCollectForwarding(this.storageRepository.removeAtoms([path.physical]), emit),
          r => r.data,
        );
      })
    );
  }

  deleteAssets(keys: readonly string[]): ContentiaStream.ContentiaStream<string, DeleteAssetsDone> {
    return ContentiaStream.make<string, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const physicalToLogical = new Map<string, string>();
        const physicalKeys: string[] = [];
        for (const key of keys) {
          const path = yield* Effect.result(this.getAssetPath(key, emit));
          if (Result.isFailure(path)) {
            yield* emit.recoverableError(path.failure);
            continue;
          }
          physicalKeys.push(path.success.physical);
          physicalToLogical.set(path.success.physical, key);
        }
        if (physicalKeys.length === 0) return { removed: 0, skipped: keys.length };

        const removed = yield* Effect.map(
          ContentiaStream.runCollectForwarding(this.storageRepository.removeAtoms(physicalKeys), emit),
          r => r.data,
        );
        let count = 0;
        for (const physical of removed) {
          yield* emit.data(physicalToLogical.get(physical) ?? physical);
          count += 1;
        }
        return { removed: count, skipped: keys.length - count };
      })
    );
  }

  getVariations(assets: Asset[]): ContentiaStream.ContentiaStream<AssetVariations, ContentiaDone> {
    return ContentiaStream.make<AssetVariations, ContentiaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        for (const asset of assets) {
          yield* emit.data({
            key: asset.key,
            variations: this.createVariationsFn ? this.createVariationsFn(asset.key) : {},
          });
        }
        return { total: assets.length };
      })
    );
  }

  getUrls(assets: Asset[]): ContentiaStream.ContentiaStream<AssetUrl, ContentiaDone> {
    return ContentiaStream.make<AssetUrl, ContentiaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let emitted = 0;
        for (const asset of assets) {
          const r = yield* Effect.result(this.getAssetPath(asset.key, emit));
          if (Result.isFailure(r)) {
            yield* emit.recoverableError(r.failure);
            continue;
          }
          const url = r.success.settings.url
            ? this.renderUrlTemplate(r.success.settings.url, asset.key)
            : asset.key;
          yield* emit.data({ key: asset.key, url });
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  getMetadata(assets: Asset[]): ContentiaStream.ContentiaStream<AssetMetadata, ContentiaDone> {
    return ContentiaStream.make<AssetMetadata, ContentiaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let emitted = 0;
        for (const asset of assets) {
          const pathR = yield* Effect.result(this.getAssetPath(asset.key, emit));
          if (Result.isFailure(pathR)) {
            yield* emit.recoverableError(pathR.failure);
            continue;
          }
          const objR = yield* Effect.result(
            ContentiaTask.runValueForwarding(this.storageRepository.getObject(pathR.success.physical), emit),
          );
          if (Result.isFailure(objR)) {
            yield* emit.recoverableError(objR.failure);
            continue;
          }
          const content = objR.success.content;
          const metadata: AssetMetadataContent = {
            kind: 'binary',
            size: typeof content.size === 'number' ? content.size : 0,
            mimeType: typeof content.mimeType === 'string' ? content.mimeType : 'application/octet-stream',
            ...(typeof content.filename === 'string' ? { filename: content.filename } : {}),
          };
          yield* emit.data({ key: asset.key, metadata });
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  // ===== Folder Operations =====

  getFolder(key: string): ContentiaTask.ContentiaTask<Folder> {
    return ContentiaTask.make<Folder>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getAssetPath(key, emit);
        const folder = yield* ContentiaTask.runValueForwarding(this.storageRepository.getFolder(path.physical), emit);
        return { ...folder, key };
      })
    );
  }

  createFolder(folderCreate: FolderCreate): ContentiaTask.ContentiaTask<Folder> {
    return ContentiaTask.make<Folder>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getAssetPath(folderCreate.key, emit);
        const folder = yield* ContentiaTask.runValueForwarding(
          this.storageRepository.createFolder({
            type: 'folder',
            key: path.physical,
          }),
          emit,
        );
        return { ...folder, key: folderCreate.key };
      })
    );
  }

  deleteFolder(key: string, _recursive?: boolean): ContentiaTask.ContentiaTask<void> {
    return ContentiaTask.make<void>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getAssetPath(key, emit);
        yield* Effect.map(
          ContentiaStream.runCollectForwarding(this.storageRepository.removeAtoms([path.physical]), emit),
          r => r.data,
        );
      })
    );
  }
}
