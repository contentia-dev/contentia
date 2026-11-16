/**
 * MCP (Model Context Protocol) surface for Contentia.
 *
 * Two generic tools — `api_request` (an authenticated "curl" into the JSON:API)
 * and `read_api_spec` (the OpenAPI contract, indexed and sliced on demand) —
 * because the API is the product; see mcp-server.ts. `contentiaMcp` mounts
 * them over Streamable HTTP with OAuth discovery metadata;
 * `createContentiaMcpServer` is the transport-agnostic factory (the
 * `contentia local mcp` CLI command connects it to stdio).
 *
 * This subpath is the module's laziness boundary: importing it pulls the MCP
 * SDK (`@modelcontextprotocol/sdk`, an optional peer of `contentia`), so apps
 * that don't speak MCP never import it.
 *
 * @module contentia/server/mcp
 */

export { createContentiaMcpServer, resolveApiRequestUrl } from './mcp-server.js';
export type { ContentiaMcpServerOptions, FetchHandler } from './mcp-server.js';

export { contentiaMcp, protectedResourceMetadata } from './mcp-routes.js';
export type { ContentiaMcp, ContentiaMcpOptions } from './mcp-routes.js';

export { buildContentiaApiOpenApi, combineOpenApiDocuments } from './openapi-combine.js';
export type { CombineOpenApiOptions, ContentiaApiOpenApiOptions, OpenApiSource } from './openapi-combine.js';

export { buildSpecIndex, hasSliceFilter, readApiSpec, sliceOpenApiDocument } from './openapi-slice.js';
export type { OpenApiSliceArgs, OpenApiSliceResult } from './openapi-slice.js';
