/**
 * The HTTP MCP mount in front of a real `contentiaApi`: the bearer gate is the
 * API's own `authenticateRequest`, and `api_request` lands in `api.fetch` with
 * the caller's token, so the API's `authorize` policy decides every call.
 */
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { CatalogDocumentsRepository } from 'contentia/documents/catalog';
import { contentiaApi } from 'contentia/server/api';
import { InMemoryStorageRepository } from 'contentia/storage/testing';
import { describe, expect, it } from 'vitest';
import { contentiaMcp } from './mcp-routes.js';
import { buildContentiaApiOpenApi } from './openapi-combine.js';

const PUBLIC_URL = 'https://cms.example.com';

async function setup() {
  const storage = new InMemoryStorageRepository();
  const catalog = new ConventionCatalogProvider({ storage });
  const documents = new CatalogDocumentsRepository(storage, catalog);
  await storage.createObject({ key: 'notes/hello', content: { title: 'Hello over MCP' } });

  const api = contentiaApi({
    documents,
    storage,
    basePath: '/api',
    authenticateAccessToken: async token => {
      if (token !== 'reader-token') throw new Error('Invalid session');
      return { id: 'reader', email: 'reader@example.com' };
    },
    authorize: ctx => ctx.operation === 'read',
  });

  const mcp = contentiaMcp({
    publicUrl: PUBLIC_URL,
    apiBasePath: '/api',
    fetch: api.fetch,
    openApi: buildContentiaApiOpenApi({ basePath: '/api', assets: false }),
    verifyBearer: async (_authorization, request) => {
      const result = await api.authenticateRequest(request);
      return result instanceof Response ? null : result;
    },
  });
  return { mcp, storage };
}

const callTool = (mcp: ReturnType<typeof contentiaMcp>, token: string, name: string, args: unknown) =>
  mcp.fetch(
    new Request(`${PUBLIC_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
  );

describe('contentiaMcp over a real contentiaApi', () => {
  it('rejects a token the API does not accept', async () => {
    const { mcp } = await setup();
    const res = await callTool(mcp, 'never-issued', 'read_api_spec', {});
    expect(res.status).toBe(401);
  });

  it("reads storage through api_request with the caller's token", async () => {
    const { mcp } = await setup();
    const res = await callTool(mcp, 'reader-token', 'api_request', {
      method: 'GET',
      path: '/api/storage/objects/notes%2Fhello',
    });
    const text = await res.text();
    expect(text).toContain('HTTP 200');
    expect(text).toContain('Hello over MCP');
  });

  it("leaves the decision to the API's authorize policy: a read-only caller cannot write", async () => {
    const { mcp, storage } = await setup();
    const res = await callTool(mcp, 'reader-token', 'api_request', {
      method: 'POST',
      path: '/api/storage/objects',
      body: { data: { type: 'object', id: 'notes/sneaky', attributes: { content: { title: 'nope' } } } },
    });
    expect(await res.text()).toContain('HTTP 403');
    await expect(storage.getObject('notes/sneaky')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('indexes the combined documents and storage contract', async () => {
    const { mcp } = await setup();
    const text = await (await callTool(mcp, 'reader-token', 'read_api_spec', {})).text();
    expect(text).toContain('/documents/records');
    expect(text).toContain('/storage/objects');
  });
});
