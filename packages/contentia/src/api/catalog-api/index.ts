// Named, not `export *`: server.js also loads openapi.js with a dynamic import(), and esbuild
// (wrangler, tsup) skips the lazy module's initializer for an `export *` re-export under
// "sideEffects": false, so a static call to the builder would crash on uninitialized data.
export { buildCatalogOpenApi } from './openapi.js';
export type { CatalogOpenApiOptions } from './openapi.js';
export * from './server.js';
