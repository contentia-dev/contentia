import { buildAssetsOpenApi } from 'contentia/assets-api';
import { buildCatalogOpenApi } from 'contentia/catalog-api';
import { buildDocumentsOpenApi } from 'contentia/documents-api';
import { buildStorageOpenApi } from 'contentia/storage-api';
import { describe, expect, it } from 'vitest';

const specs = [
  ['assets', buildAssetsOpenApi],
  ['catalog', buildCatalogOpenApi],
  ['documents', buildDocumentsOpenApi],
  ['storage', buildStorageOpenApi],
];

describe('generate-openapi-docs', () => {
  for (const [name, build] of specs) {
    it(`${name}: returns a spec with an openapi version and non-empty paths`, () => {
      const spec = build();
      expect(typeof spec).toBe('object');
      expect(spec).not.toBeNull();
      expect(typeof spec.openapi).toBe('string');
      expect(spec.openapi.length).toBeGreaterThan(0);
      expect(typeof spec.paths).toBe('object');
      expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    });
  }
});
