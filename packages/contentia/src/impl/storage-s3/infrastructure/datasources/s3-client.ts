/**
 * The slice of the AWS SDK v3 S3 API that `S3StorageRepository` uses, typed
 * structurally so `contentia` never imports `@aws-sdk/client-s3` itself.
 * Callers pass in the real `S3Client` and command classes; anything with the
 * same shape (a test double, another S3-compatible SDK) works too.
 */

export interface S3HeadObjectInput {
  Bucket: string;
  Key: string;
}

export interface S3GetObjectInput {
  Bucket: string;
  Key: string;
}

export interface S3PutObjectInput {
  Bucket: string;
  Key: string;
  Body: string;
  ContentType?: string;
  /** User metadata, sent as `x-amz-meta-*` headers. */
  Metadata?: Record<string, string>;
}

export interface S3DeleteObjectInput {
  Bucket: string;
  Key: string;
}

export interface S3ListObjectsV2Input {
  Bucket: string;
  Prefix?: string;
  Delimiter?: string;
  ContinuationToken?: string;
  MaxKeys?: number;
}

export interface S3HeadObjectOutput {
  ContentLength?: number;
  ETag?: string;
  LastModified?: Date;
  Metadata?: Record<string, string>;
}

export interface S3GetObjectOutput extends S3HeadObjectOutput {
  Body?: {
    transformToString(encoding?: string): Promise<string>,
  };
}

export interface S3ListObjectsV2Output {
  Contents?: Array<{ Key?: string, Size?: number, ETag?: string, LastModified?: Date }>;
  CommonPrefixes?: Array<{ Prefix?: string }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}

/** The `S3Client.send(command)` surface of the AWS SDK v3. */
export interface S3ClientLike {
  send(command: object): Promise<unknown>;
}

/**
 * The command classes from `@aws-sdk/client-s3`. Passing them in (rather than
 * importing them here) keeps the AWS SDK out of every bundle that doesn't use S3.
 */
export interface S3Commands {
  HeadObjectCommand: new(input: S3HeadObjectInput) => object;
  GetObjectCommand: new(input: S3GetObjectInput) => object;
  PutObjectCommand: new(input: S3PutObjectInput) => object;
  DeleteObjectCommand: new(input: S3DeleteObjectInput) => object;
  ListObjectsV2Command: new(input: S3ListObjectsV2Input) => object;
}

export interface S3Config {
  /** An `S3Client` from `@aws-sdk/client-s3` (or anything with the same `send`). */
  client: S3ClientLike;
  /** The bucket to read from and write to. */
  bucket: string;
  /** The command classes from `@aws-sdk/client-s3`. */
  commands: S3Commands;
  /**
   * Scope every key under this prefix, e.g. `'tenant-a'` stores `docs/x.json`
   * as `tenant-a/docs/x.json`. Leading/trailing slashes are normalised.
   */
  keyPrefix?: string;
}
