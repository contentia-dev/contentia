import type { StorageContractCase } from '../../domain/storage/testing/index.js';
import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';

import type {
  S3ClientLike,
  S3Commands,
  S3DeleteObjectInput,
  S3GetObjectInput,
  S3GetObjectOutput,
  S3HeadObjectInput,
  S3HeadObjectOutput,
  S3ListObjectsV2Input,
  S3ListObjectsV2Output,
  S3PutObjectInput,
} from './infrastructure/datasources/s3-client.js';
import { S3StorageRepository } from './infrastructure/repositories/s3-storage-repository.js';

export interface InMemoryS3Object {
  body: string;
  contentType?: string;
  metadata: Record<string, string>;
  lastModified: Date;
  etag: string;
}

class Command<I> {
  constructor(readonly input: I) {}
}

/** Command classes shaped like `@aws-sdk/client-s3`'s, for the in-memory client. */
export const inMemoryS3Commands = {
  HeadObjectCommand: class HeadObjectCommand extends Command<S3HeadObjectInput> {},
  GetObjectCommand: class GetObjectCommand extends Command<S3GetObjectInput> {},
  PutObjectCommand: class PutObjectCommand extends Command<S3PutObjectInput> {},
  DeleteObjectCommand: class DeleteObjectCommand extends Command<S3DeleteObjectInput> {},
  ListObjectsV2Command: class ListObjectsV2Command extends Command<S3ListObjectsV2Input> {},
} satisfies S3Commands;

const noSuchKey = (name: 'NotFound' | 'NoSuchKey') =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });

/**
 * An in-memory S3 bucket behind an `S3ClientLike`, following S3's semantics
 * for the five commands `S3StorageRepository` sends: HEAD/GET 404 with
 * `NotFound`/`NoSuchKey`, DELETE is idempotent, user metadata is stored per
 * object, and `ListObjectsV2` honours `Prefix`, `Delimiter`, `MaxKeys`
 * (counting common prefixes, default 1000) and opaque continuation tokens.
 */
export class InMemoryS3Client implements S3ClientLike {
  /** Objects per bucket, keyed by full object key. */
  readonly buckets = new Map<string, Map<string, InMemoryS3Object>>();
  /** Every command received, in order — for asserting on request shape. */
  readonly sent: object[] = [];
  private clock = Date.parse('2026-01-01T00:00:00Z');
  private etags = 0;

  bucket(name: string): Map<string, InMemoryS3Object> {
    let objects = this.buckets.get(name);
    if (!objects) this.buckets.set(name, objects = new Map());
    return objects;
  }

  async send(command: object): Promise<unknown> {
    this.sent.push(command);
    const c = inMemoryS3Commands;
    if (command instanceof c.HeadObjectCommand) return this.head(command.input);
    if (command instanceof c.GetObjectCommand) return this.get(command.input);
    if (command instanceof c.PutObjectCommand) return this.put(command.input);
    if (command instanceof c.DeleteObjectCommand) return this.delete(command.input);
    if (command instanceof c.ListObjectsV2Command) return this.list(command.input);
    throw new Error(`InMemoryS3Client: unsupported command ${command.constructor.name}`);
  }

  private head({ Bucket, Key }: S3HeadObjectInput): S3HeadObjectOutput {
    const object = this.bucket(Bucket).get(Key);
    if (!object) throw noSuchKey('NotFound');
    return {
      ContentLength: object.body.length,
      ETag: object.etag,
      LastModified: object.lastModified,
      Metadata: { ...object.metadata },
    };
  }

  private get(input: S3GetObjectInput): S3GetObjectOutput {
    const object = this.bucket(input.Bucket).get(input.Key);
    if (!object) throw noSuchKey('NoSuchKey');
    return { ...this.head(input), Body: { transformToString: async () => object.body } };
  }

  private put({ Bucket, Key, Body, ContentType, Metadata }: S3PutObjectInput): object {
    // Each write advances the clock so LastModified visibly changes.
    this.clock += 1000;
    const etag = `"etag-${++this.etags}"`;
    this.bucket(Bucket).set(Key, {
      body: Body,
      contentType: ContentType,
      metadata: { ...Metadata },
      lastModified: new Date(this.clock),
      etag,
    });
    return { ETag: etag };
  }

  private delete({ Bucket, Key }: S3DeleteObjectInput): object {
    this.bucket(Bucket).delete(Key);
    return {};
  }

  private list({ Bucket, Prefix = '', Delimiter, ContinuationToken, MaxKeys = 1000 }: S3ListObjectsV2Input) {
    // Keys and common prefixes in lexicographic order, as S3 returns them.
    const items: Array<{ prefix: string } | { key: string, object: InMemoryS3Object }> = [];
    const seen = new Set<string>();
    const keys = [...this.bucket(Bucket).keys()].filter(k => k.startsWith(Prefix)).sort();
    for (const key of keys) {
      const sep = Delimiter ? key.indexOf(Delimiter, Prefix.length) : -1;
      if (sep === -1) {
        items.push({ key, object: this.bucket(Bucket).get(key)! });
        continue;
      }
      const prefix = key.slice(0, sep + Delimiter!.length);
      if (!seen.has(prefix)) {
        seen.add(prefix);
        items.push({ prefix });
      }
    }
    const start = ContinuationToken ? Number(atob(ContinuationToken)) : 0;
    const page = items.slice(start, start + MaxKeys);
    const truncated = start + MaxKeys < items.length;
    return {
      Contents: page.flatMap(item =>
        'key' in item
          ? [{
            Key: item.key,
            Size: item.object.body.length,
            ETag: item.object.etag,
            LastModified: item.object.lastModified,
          }]
          : []
      ),
      CommonPrefixes: page.flatMap(item => ('prefix' in item ? [{ Prefix: item.prefix }] : [])),
      IsTruncated: truncated,
      NextContinuationToken: truncated ? btoa(String(start + MaxKeys)) : undefined,
    } satisfies S3ListObjectsV2Output;
  }
}

export const s3StorageContractCase: StorageContractCase = {
  name: 'S3StorageRepository (in-memory S3 client)',
  makeRepo: async () =>
    new S3StorageRepository(
      { client: new InMemoryS3Client(), bucket: 'contract', commands: inMemoryS3Commands },
      { json: jsonSerializer },
      'json',
    ),
  // ListObjectsV2 can't tell a missing prefix from an empty one; an empty
  // listing is reported as a missing folder with a recoverable warning.
  missingFolderBehavior: 'warning',
};
