# `contentia/storage/s3`

A `StorageRepository` on any S3-compatible object store: AWS S3, MinIO, Backblaze B2, DigitalOcean
Spaces, Cloudflare R2 over its S3 endpoint, or any other service that speaks the S3 API. On a
Cloudflare Worker with an R2 bucket binding, use [`contentia/storage/r2`](../storage-r2) instead.

`@aws-sdk/client-s3` is not a dependency of `contentia`. You pass in your own `S3Client` and the
command classes, so code that doesn't use S3 never bundles the AWS SDK.

## Usage

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { jsonSerializer } from 'contentia/serializers/json';
import { S3StorageRepository } from 'contentia/storage/s3';

const repo = new S3StorageRepository(
  {
    client: new S3Client({ region: 'eu-west-1' }),
    bucket: 'my-content',
    commands: {
      HeadObjectCommand,
      GetObjectCommand,
      PutObjectCommand,
      DeleteObjectCommand,
      ListObjectsV2Command,
    },
  },
  { json: jsonSerializer },
  'json',
);
```

For MinIO, B2 or any other non-AWS store, set `endpoint` (and usually `forcePathStyle: true`) on the
`S3Client`. For R2's S3 endpoint, use `region: 'auto'` and
`endpoint: 'https://<account-id>.r2.cloudflarestorage.com'`.

### Constructor parameters

| Parameter              | Position | Required | Default                                                                                          | Description                                                                          |
| ---------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `config`               | 1st      | yes      | —                                                                                                | `S3Config`, see below.                                                               |
| `serializerRegistry`   | 2nd      | yes      | —                                                                                                | Maps file extension → `StorageSerializer`, same as every other `StorageRepository`.  |
| `defaultFileExtension` | 3rd      | yes      | —                                                                                                | Extension used for new objects when no other extension is determined.                |
| `ignoreList`           | 4th      | no       | `['**/.keep', '**/.DS_Store', '**/Thumbs.db', '**/desktop.ini', '**/.catalog', '**/.contentia']` | [Glob patterns](../../domain/storage/README.md#ignore-lists) excluded from listings. |
| `determineExtension`   | 5th      | no       | `defaultDetermineExtension`                                                                      | Overrides how the extension of a new object is chosen.                               |

### `S3Config`

| Field       | Type           | Required | Description                                                                                                                                         |
| ----------- | -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`    | `S3ClientLike` | yes      | An `S3Client` from `@aws-sdk/client-s3`, or anything with the same `send(command)` method.                                                          |
| `bucket`    | `string`       | yes      | The bucket to read from and write to.                                                                                                               |
| `commands`  | `S3Commands`   | yes      | `HeadObjectCommand`, `GetObjectCommand`, `PutObjectCommand`, `DeleteObjectCommand` and `ListObjectsV2Command` from `@aws-sdk/client-s3`.            |
| `keyPrefix` | `string`       | no       | Stores every key under this prefix, e.g. `'tenant-a'` stores `docs/x.json` as `tenant-a/docs/x.json`. Slashes are normalised. Callers never see it. |

## Behaviour notes

- **Folders.** S3 has no folders. A folder is a key prefix, and `createFolder` writes an empty
  `.keep` object so an empty folder can still be listed. Zero-byte `folder/` placeholders (the kind
  the AWS console creates) also count as a folder.
- **Extensions.** Objects are stored as `<key>.<extension>`, and the public API never shows the
  extension: `getObject('posts/a')` finds whichever registered extension exists. `createObject`
  fails with `EntryAlreadyExistsError` if the key exists under any registered extension.
- **Reads.** `getObject` is a single `GetObject` per tried extension. The body, `LastModified` and
  metadata all come back in one response.
- **`createdAt` survives overwrites.** S3 resets `LastModified` on every PUT, so the creation time
  is stored as the `contentia-created-at` user metadata (`x-amz-meta-contentia-created-at`).
  `updateObject` and `createOrUpdateObject` carry it forward. Objects written by other tools have no
  such metadata, so their `createdAt` falls back to `LastModified`.
- **Missing folders.** `ListObjectsV2` never 404s, so a missing prefix and an empty one look the
  same. A listing with nothing in it at all (not even a `.keep` marker) is treated as a missing
  folder: `listAtoms`/`listAtomSummaries` return `total: 0` with a recoverable `NotFoundError`, the
  same as `storage-fs`'s `listAtoms`, WebDAV, R2, GitLab and Bitbucket. See LCMS-1004.
- **Deletes.** S3's `DeleteObject` succeeds for keys that don't exist, so `removeAtoms` resolves
  each key first. Missing keys are reported as skipped, with a recoverable `NotFoundError`.
- **403s are errors, not misses.** S3 answers 403 instead of 404 for missing keys when the
  credentials lack `s3:ListBucket`. That surfaces as an `InternalError`, not as "not found", so a
  permissions problem doesn't look like an empty bucket. Grant `s3:ListBucket` on the bucket plus
  `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on its objects.
- **Consistency.** AWS S3 has strong read-after-write consistency. Not every S3-compatible store
  does, so if the readback after a write misses, the repository emits a recoverable warning and
  returns the object it just wrote instead of failing.
- **Capabilities.** Pagination is in-memory offset/page slicing over the full listing. Cursor
  pagination and `subscribeChanges` are not supported.

## Testing

`testing.ts` exports `InMemoryS3Client` and `inMemoryS3Commands`, an in-memory bucket that follows
S3's semantics for the five commands above (404 errors, idempotent deletes, user metadata,
`ListObjectsV2` delimiters, `MaxKeys` and continuation tokens). It also exports
`s3StorageContractCase`, which runs the shared storage contract against it. See the
[storage testkit convention](../storage-fs/testing/README.md).
