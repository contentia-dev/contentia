import type { StorageSerializerRegistry } from 'contentia/storage';
import { jsonSerializer } from 'contentia/storage-serializers-json';
import { markdownSerializer } from 'contentia/storage-serializers-markdown';
import { rawSerializer } from 'contentia/storage-serializers-raw';
import { yamlSerializer } from 'contentia/storage-serializers-yaml';

/**
 * Same registry the `serve` command uses. Drivers fall back to this when the
 * user hasn't configured a custom set on the BackendSpec.
 */
export const defaultSerializerRegistry: StorageSerializerRegistry = {
  md: markdownSerializer,
  markdown: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
  raw: rawSerializer,
};
