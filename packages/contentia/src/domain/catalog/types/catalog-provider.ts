import type { ContentiaTask } from 'contentia/core';
import type { JSONSchema7 } from 'json-schema';
import type { Catalog, DocumentCollectionSettings, MediaCollectionSettings } from '../entities/catalog.js';

/**
 * Source of truth for catalog configuration — collection settings, media settings,
 * and per-collection JSON Schemas.
 *
 * **Cache-key stability invariant:** for a given persisted catalog state,
 * `getDocumentCollectionSettings(collection).directory` and
 * `getMediaCollectionSettings(collection).directory` are *pure, stable* functions
 * of the `collection` argument. Two provider instances pointed at the same
 * underlying storage MUST return identical `directory` values for the same
 * collection key — both within a single process and across rolling deploys.
 *
 * This guarantee exists so consumers (e.g. `CachedStorageRepository`,
 * webhook-invalidators) can safely derive cache keys from provider output
 * without risking invalidation desync between replicas running different
 * code versions.
 *
 * Implementations that violate this invariant (e.g. by injecting a
 * non-deterministic prefix) must document the deviation explicitly.
 */
export abstract class CatalogProvider {
  abstract getCatalog(): ContentiaTask.ContentiaTask<Catalog>;
  abstract putCatalog(settings: Catalog): ContentiaTask.ContentiaTask<void>;
  /**
   * Returns settings for a document collection. If the collection is not
   * explicitly configured, a deterministic default derived solely from the
   * `collection` key is returned (stable across instances — see class-level
   * cache-key stability invariant).
   */
  abstract getDocumentCollectionSettings(
    collection: string,
  ): ContentiaTask.ContentiaTask<DocumentCollectionSettings>;
  abstract putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings,
  ): ContentiaTask.ContentiaTask<void>;
  /**
   * Returns settings for a media collection. If the collection is not
   * explicitly configured, a deterministic default derived solely from the
   * `collection` key is returned (stable across instances — see class-level
   * cache-key stability invariant).
   */
  abstract getMediaCollectionSettings(
    collection: string,
  ): ContentiaTask.ContentiaTask<MediaCollectionSettings>;
  abstract putMediaCollectionSettings(
    collection: string,
    settings: MediaCollectionSettings,
  ): ContentiaTask.ContentiaTask<void>;
  abstract getCollectionSchema(
    collection: string,
  ): ContentiaTask.ContentiaTask<JSONSchema7>;
  abstract putCollectionSchema(
    collection: string,
    schema: JSONSchema7,
  ): ContentiaTask.ContentiaTask<void>;
}
