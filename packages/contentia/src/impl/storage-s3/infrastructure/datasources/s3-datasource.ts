import type { ContentiaResult } from 'contentia/core';
import { InternalError, NotFoundError } from 'contentia/core';
import type { TranslationKey } from 'contentia/i18n';
import type { Key } from 'contentia/storage';
import * as Cause from 'effect/Cause';
import * as Result from 'effect/Result';

import type { S3Entry } from '../../domain/entities/s3-entry.js';
import type {
  S3ClientLike,
  S3Commands,
  S3Config,
  S3GetObjectOutput,
  S3HeadObjectOutput,
  S3ListObjectsV2Output,
} from './s3-client.js';

/**
 * User-metadata key holding the object's creation time. S3 resets
 * `LastModified` on every PUT, so `createdAt` has to be carried in metadata.
 */
export const CREATED_AT_METADATA_KEY = 'contentia-created-at';

const FOLDER_MARKER = '.keep';

export interface S3ObjectInfo {
  /** Key without its file extension, as exposed by the `StorageRepository`. */
  key: string;
  extension: string;
  size: number;
  etag: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface S3ObjectWithContent extends S3ObjectInfo {
  content: string;
}

/**
 * Whether an SDK error means "no such object". HEAD reports `NotFound`, GET
 * reports `NoSuchKey`; S3-compatible stores don't always set `name`, so the
 * HTTP status is checked too. A 403 is deliberately *not* treated as missing:
 * S3 answers 403 for missing keys when the caller lacks `s3:ListBucket`, and
 * hiding that would turn a permissions problem into silent empty reads.
 */
const isNotFound = (error: unknown): boolean => {
  const e = error as { name?: string, $metadata?: { httpStatusCode?: number } } | undefined;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

const trimSlashes = (key: string): string => key.replace(/^\/+|\/+$/g, '');

const internal = (message: string, translationKey: TranslationKey, error: unknown) =>
  Result.fail(
    new InternalError(message, {
      cause: Cause.fail(error),
      translation: { message: translationKey },
    }),
  );

/**
 * Low-level S3 operations. Maps the hierarchical storage model onto flat
 * object keys: folders are key prefixes, empty folders hold a `.keep` marker,
 * and an object is stored as `<key>.<extension>` for one of the registered
 * serializer extensions. Every method resolves to a `ContentiaResult`; none
 * of them throw.
 */
export class S3DataSource {
  private readonly client: S3ClientLike;
  private readonly bucket: string;
  private readonly commands: S3Commands;
  private readonly keyPrefix: string;

  constructor(config: S3Config, private readonly availableExtensions: readonly string[]) {
    this.client = config.client;
    this.bucket = config.bucket;
    this.commands = config.commands;
    const prefix = trimSlashes(config.keyPrefix ?? '');
    this.keyPrefix = prefix ? `${prefix}/` : '';
  }

  /** Strip a registered serializer extension from `key`, if it has one. */
  stripExtension(key: Key): Key {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) return key.slice(0, -(ext.length + 1));
    }
    return key;
  }

  private baseKey(key: Key): Key {
    return this.stripExtension(trimSlashes(key));
  }

  /** The S3 prefix that lists the children of `folderKey`. */
  private folderPrefix(folderKey: Key): string {
    const normalized = trimSlashes(folderKey);
    return this.keyPrefix + (normalized ? `${normalized}/` : '');
  }

  private toInfo(base: Key, extension: string, out: S3HeadObjectOutput): S3ObjectInfo {
    // S3 always sends Last-Modified; the fallback only covers odd S3-compatible stores.
    const updatedAt = out.LastModified ?? new Date();
    const stored = out.Metadata?.[CREATED_AT_METADATA_KEY];
    const storedDate = stored ? new Date(stored) : undefined;
    const createdAt = storedDate && !Number.isNaN(storedDate.getTime()) ? storedDate : updatedAt;
    return {
      key: base,
      extension,
      size: out.ContentLength ?? 0,
      etag: out.ETag ?? '',
      createdAt,
      updatedAt,
    };
  }

  /**
   * HEAD the object under each registered extension and return the first hit,
   * or `undefined` when no extension matches.
   */
  async findObject(key: Key): Promise<ContentiaResult<S3ObjectInfo | undefined>> {
    const base = this.baseKey(key);
    for (const ext of this.availableExtensions) {
      try {
        const out = (await this.client.send(
          new this.commands.HeadObjectCommand({ Bucket: this.bucket, Key: `${this.keyPrefix}${base}.${ext}` }),
        )) as S3HeadObjectOutput;
        return Result.succeed(this.toInfo(base, ext, out));
      } catch (error) {
        if (isNotFound(error)) continue;
        return internal(`Failed to get object metadata for ${key}`, 'storage.s3.failedToGetObjectMetadata', error);
      }
    }
    return Result.succeed(undefined);
  }

  /** Like {@link findObject}, but a missing object is a `NotFoundError`. */
  async headObject(key: Key): Promise<ContentiaResult<S3ObjectInfo>> {
    const found = await this.findObject(key);
    if (Result.isFailure(found)) return Result.fail(found.failure);
    if (!found.success) return Result.fail(this.notFound(key));
    return Result.succeed(found.success);
  }

  /**
   * GET the object under each registered extension. One request returns both
   * the body and its metadata, so a read never needs a separate HEAD.
   */
  async readObject(key: Key): Promise<ContentiaResult<S3ObjectWithContent>> {
    const base = this.baseKey(key);
    for (const ext of this.availableExtensions) {
      try {
        const out = (await this.client.send(
          new this.commands.GetObjectCommand({ Bucket: this.bucket, Key: `${this.keyPrefix}${base}.${ext}` }),
        )) as S3GetObjectOutput;
        const content = out.Body ? await out.Body.transformToString('utf-8') : '';
        return Result.succeed({ ...this.toInfo(base, ext, out), content });
      } catch (error) {
        if (isNotFound(error)) continue;
        return internal(`Failed to read object ${key}`, 'storage.s3.failedToReadObject', error);
      }
    }
    return Result.fail(this.notFound(key));
  }

  /** PUT `<key>.<extension>`, recording `createdAt` in user metadata. */
  async putObject(key: Key, extension: string, content: string, createdAt: Date): Promise<ContentiaResult<void>> {
    try {
      await this.client.send(
        new this.commands.PutObjectCommand({
          Bucket: this.bucket,
          Key: `${this.keyPrefix}${this.baseKey(key)}.${extension}`,
          Body: content,
          ContentType: contentTypeFor(extension),
          Metadata: { [CREATED_AT_METADATA_KEY]: createdAt.toISOString() },
        }),
      );
      return Result.succeed(undefined);
    } catch (error) {
      return internal(`Failed to write object ${key}`, 'storage.s3.failedToWriteObject', error);
    }
  }

  /** PUT an empty `.keep` marker so an otherwise-empty folder is listable. */
  async putFolderMarker(folderKey: Key): Promise<ContentiaResult<void>> {
    try {
      await this.client.send(
        new this.commands.PutObjectCommand({
          Bucket: this.bucket,
          Key: `${this.folderPrefix(folderKey)}${FOLDER_MARKER}`,
          Body: '',
          ContentType: 'application/octet-stream',
        }),
      );
      return Result.succeed(undefined);
    } catch (error) {
      return internal(`Failed to create folder ${folderKey}`, 'storage.s3.failedToWriteObject', error);
    }
  }

  /**
   * Delete the object behind `key`. S3's DELETE succeeds for missing keys too,
   * so the object is resolved first to report a `NotFoundError` for keys that
   * don't exist. Resolves to the key without extension.
   */
  async deleteObject(key: Key): Promise<ContentiaResult<Key>> {
    const found = await this.findObject(key);
    if (Result.isFailure(found)) return Result.fail(found.failure);
    if (!found.success) return Result.fail(this.notFound(key));
    const { key: base, extension } = found.success;
    try {
      await this.client.send(
        new this.commands.DeleteObjectCommand({ Bucket: this.bucket, Key: `${this.keyPrefix}${base}.${extension}` }),
      );
      return Result.succeed(base);
    } catch (error) {
      return internal(`Failed to delete object ${key}`, 'storage.s3.failedToDeleteObject', error);
    }
  }

  /**
   * List the direct children of `folderKey`, following continuation tokens.
   * `ListObjectsV2` never 404s: a missing prefix and an empty one both come
   * back empty. A listing with nothing in it at all (not even a `.keep`
   * marker or a console-created `folder/` placeholder) is reported as a
   * missing folder, matching the FS/WebDAV contract.
   */
  async listDirectory(folderKey: Key): Promise<ContentiaResult<S3Entry[]>> {
    const prefix = this.folderPrefix(folderKey);
    const entries: S3Entry[] = [];
    let found = false;
    let token: string | undefined;
    try {
      do {
        const out = (await this.client.send(
          new this.commands.ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix || undefined,
            Delimiter: '/',
            ContinuationToken: token,
          }),
        )) as S3ListObjectsV2Output;

        for (const object of out.Contents ?? []) {
          if (object.Key === undefined) continue;
          found = true;
          const name = object.Key.slice(prefix.length);
          // `folder/` placeholders (S3 console) and `.keep` markers prove the
          // folder exists but aren't entries of their own.
          if (name === '' || name.endsWith('/') || name === FOLDER_MARKER) continue;
          entries.push({ type: 'file', key: object.Key.slice(this.keyPrefix.length) });
        }
        for (const common of out.CommonPrefixes ?? []) {
          if (common.Prefix === undefined) continue;
          found = true;
          entries.push({ type: 'dir', key: common.Prefix.slice(this.keyPrefix.length).replace(/\/$/, '') });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
    } catch (error) {
      return internal(`Failed to list folder ${folderKey}`, 'storage.s3.failedToListDirectory', error);
    }

    if (!found) {
      return Result.fail(
        new NotFoundError(`Folder at ${folderKey} does not exist`, {
          translation: { message: 'storage.s3.directoryNotFound' },
        }),
      );
    }
    return Result.succeed(entries);
  }

  /** Whether any object lives under `folderKey/`. */
  async folderExists(folderKey: Key): Promise<ContentiaResult<boolean>> {
    const prefix = this.folderPrefix(folderKey);
    try {
      const out = (await this.client.send(
        new this.commands.ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix || undefined, MaxKeys: 1 }),
      )) as S3ListObjectsV2Output;
      return Result.succeed((out.Contents?.length ?? 0) > 0 || (out.CommonPrefixes?.length ?? 0) > 0);
    } catch (error) {
      return internal(`Failed to check folder ${folderKey}`, 'storage.s3.failedToListDirectory', error);
    }
  }

  private notFound(key: Key): NotFoundError {
    return new NotFoundError(`Object at ${key} does not exist`, {
      translation: { message: 'storage.s3.fileNotFound' },
    });
  }
}

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  md: 'text/markdown',
  mdx: 'text/markdown',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  txt: 'text/plain',
  html: 'text/html',
  xml: 'application/xml',
};

const contentTypeFor = (extension: string): string => CONTENT_TYPES[extension] ?? 'application/octet-stream';
