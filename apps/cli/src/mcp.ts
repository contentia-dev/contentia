/**
 * `contentia local mcp` — the Contentia MCP server over stdio, for Claude Code /
 * Claude Desktop and any other stdio MCP client.
 *
 * Reuses the two-tool server from `contentia/server/mcp` (`api_request` +
 * `read_api_spec`) and only decides where `api_request` lands:
 *
 *  - default: the same storage JSON:API `contentia local serve` exposes, over
 *    the same backend (`--root` / `--backend`), dispatched in-process (no HTTP
 *    server, no port);
 *  - `--base-url`: a remote Contentia JSON:API over real fetch, with the
 *    caller's `--auth-token` attached as a Bearer.
 *
 * IMPORTANT for anything touched from this module: stdout belongs to the MCP
 * protocol. Diagnostics must go to stderr or they corrupt the JSON-RPC stream.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { allowAll } from 'contentia/json-api';
import { buildContentiaApiOpenApi, createContentiaMcpServer, type FetchHandler } from 'contentia/server/mcp';
import type { StorageRepository } from 'contentia/storage';
import { buildJsonApi, buildStorageOpenApi } from 'contentia/storage/api';

/**
 * Private origin for the in-process handler. Never resolved over the network —
 * it only exists because `api_request` paths must resolve against some URL.
 */
const LOCAL_ORIGIN = 'http://contentia.local';

export interface LocalMcpServerOptions {
  /** The storage backend to expose, built the same way `contentia local serve` builds it. */
  repository: StorageRepository;
}

/**
 * MCP server over a storage JSON:API — the stdio twin of `contentia local serve`,
 * dispatching in-process instead of listening on a port. Access control is the
 * process boundary: whoever can spawn this server can reach the backend
 * anyway, so the JSON:API allows all (same stance as `serve` without
 * `--auth-token`).
 */
export const buildLocalMcpServer = (options: LocalMcpServerOptions): Server => {
  // No logger: stdio MCP reserves stdout for the protocol.
  const api = buildJsonApi({ repo: options.repository, authorize: allowAll });
  return createContentiaMcpServer({
    apiUrl: LOCAL_ORIGIN,
    fetch: api.fetch,
    openApi: buildStorageOpenApi(),
    instructions: 'Access to a Contentia storage JSON:API on this machine. '
      + 'Call read_api_spec with no arguments for an index of the API surface (OpenAPI 3.1), then call it again with '
      + 'paths/tag/search for the operations you need. Use api_request for everything else. Writes hit the real '
      + 'backend - confirm with the user before POST/PUT/PATCH/DELETE.',
  });
};

export interface RemoteMcpServerOptions {
  /** Absolute URL of the remote JSON:API root, e.g. `https://cms.example.com/api`. */
  baseUrl: string;
  /** Bearer token attached to every `api_request` (`Authorization: Bearer <token>`). */
  authToken?: string | undefined;
  /** Seam for tests; production uses the runtime's `fetch`. */
  fetch?: FetchHandler | undefined;
}

/**
 * MCP server proxying a remote Contentia JSON:API (`contentiaApi`) over real
 * fetch. The remote deployment's own authentication and `authorize` policy
 * decide what the token may do.
 */
export const buildRemoteMcpServer = (options: RemoteMcpServerOptions): Server => {
  const apiUrl = new URL(options.baseUrl).toString().replace(/\/+$/, '');
  const basePath = new URL(apiUrl).pathname.replace(/\/+$/, '');
  return createContentiaMcpServer({
    apiUrl,
    fetch: options.fetch ?? (request => globalThis.fetch(request)),
    openApi: buildContentiaApiOpenApi({ basePath }),
    authorization: options.authToken ? `Bearer ${options.authToken}` : undefined,
  });
};

/**
 * Serve `server` over stdio until the client disconnects (stdin closes) or
 * `signal` aborts. Resolves on clean shutdown.
 */
export const runMcpStdioServer = (server: Server, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const transport = new StdioServerTransport();
    server.onclose = () => resolve();
    const close = () => void server.close().then(resolve, reject);
    signal?.addEventListener('abort', close);
    // The SDK transport only listens for data and errors, so a client that
    // closes our stdin would leave the process running forever.
    process.stdin.once('end', close);
    server.connect(transport).catch((error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
