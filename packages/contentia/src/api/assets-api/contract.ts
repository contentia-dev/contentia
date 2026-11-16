// Values the handler and its OpenAPI document must agree on. A module of its
// own so the server reads them without loading the lazily imported spec.

/** Version of the assets HTTP API contract: the spec's `info.version` and the `version` `GET /` reports. */
export const ASSETS_API_VERSION = '1.0.1';

/**
 * Page size GET /resources lists with when `page[number]`, `page[after]`,
 * `page[before]` or `page[offset]` arrives without a size of its own. A request
 * with no `page[*]` key at all gets `parsePaginationQuery`'s default instead.
 */
export const UNSIZED_PAGE_SIZE = 100;
