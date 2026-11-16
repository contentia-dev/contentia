/**
 * An entry in an S3 "directory" listing. S3 has no folders, so a directory is
 * a common key prefix (`ListObjectsV2` with `Delimiter: '/'`) and a file is an
 * object key. `key` is relative to the repository's `keyPrefix` and still
 * carries its file extension.
 */
export interface S3Entry {
  type: 'file' | 'dir';
  key: string;
}
