import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The `contentia/*` workspace package exports point to `./dist/*` which is not
 * built during test runs. Alias each used subpath to its TypeScript source so
 * Vitest can resolve and transform it directly.
 */
const contentiaSrc = path.resolve(import.meta.dirname, '../contentia/src');

export default defineConfig({
  resolve: {
    alias: {
      'contentia/core': path.join(contentiaSrc, 'shared/core/index.ts'),
      'contentia/crypto': path.join(contentiaSrc, 'shared/crypto/index.ts'),
      'contentia/auth': path.join(contentiaSrc, 'shared/auth/index.ts'),
      'contentia/locks/in-process': path.join(contentiaSrc, 'impl/locks-in-process/index.ts'),
      'contentia/assets/api': path.join(contentiaSrc, 'api/assets-api/index.ts'),
      'contentia/documents/api': path.join(contentiaSrc, 'api/documents-api/index.ts'),
      'contentia/storage/api': path.join(contentiaSrc, 'api/storage-api/index.ts'),
      'contentia/storage': path.join(contentiaSrc, 'domain/storage/index.ts'),
      'contentia/json-api': path.join(contentiaSrc, 'shared/json-api/index.ts'),
      'contentia/assets': path.join(contentiaSrc, 'domain/assets/index.ts'),
      'contentia/documents': path.join(contentiaSrc, 'domain/documents/index.ts'),
      'contentia/catalog': path.join(contentiaSrc, 'domain/catalog/index.ts'),
      'contentia/assets-catalog': path.join(contentiaSrc, 'impl/assets-catalog/index.ts'),
      'contentia/catalog-decap': path.join(contentiaSrc, 'impl/catalog-decap/index.ts'),
      'contentia/compat': path.join(contentiaSrc, 'shared/core/compat.ts'),
      'contentia/documents-catalog': path.join(contentiaSrc, 'impl/documents-catalog/index.ts'),
      'contentia/storage-fs': path.join(contentiaSrc, 'impl/storage-fs/index.ts'),
      'contentia/storage/fs': path.join(contentiaSrc, 'impl/storage-fs/index.ts'),
      'contentia/storage-serializers-json': path.join(contentiaSrc, 'serializers/storage-serializers-json/index.ts'),
      'contentia/storage-serializers-markdown': path.join(
        contentiaSrc,
        'serializers/storage-serializers-markdown/index.ts',
      ),
      'contentia/storage-serializers-raw': path.join(contentiaSrc, 'serializers/storage-serializers-raw/index.ts'),
      'contentia/storage-serializers-yaml': path.join(contentiaSrc, 'serializers/storage-serializers-yaml/index.ts'),
      'contentia/serializers/yaml': path.join(contentiaSrc, 'serializers/storage-serializers-yaml/index.ts'),
    },
  },
  test: {
    // Only run the source tests; never the stale compiled copies under dist/.
    include: ['src/**/*.test.ts'],
  },
});
