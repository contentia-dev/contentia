import type { OpenApiDocument } from 'contentia/json-api';
import { describe, expect, it } from 'vitest';
import { contentiaMcp, type ContentiaMcpOptions, protectedResourceMetadata } from './mcp-routes.js';

const PUBLIC_URL = 'http://localhost:3101';

const OPEN_API = {
  openapi: '3.1.0',
  info: { title: 'Contentia API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {},
  components: {},
} as unknown as OpenApiDocument;

const makeMcp = (overrides: Partial<ContentiaMcpOptions> = {}) =>
  contentiaMcp({
    publicUrl: PUBLIC_URL,
    apiBasePath: '/api',
    fetch: async () => new Response('{}', { status: 200 }),
    openApi: OPEN_API,
    verifyBearer: authorization => authorization === 'Bearer valid-token' ? { id: 'user-1' } : null,
    ...overrides,
  });

describe('OAuth discovery metadata', () => {
  it('serves protected-resource metadata on both well-known paths', async () => {
    const mcp = makeMcp();
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await mcp.fetch(new Request(`${PUBLIC_URL}${path}`));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(protectedResourceMetadata(PUBLIC_URL));
    }
  });

  it('advertises an external authorization server when one is configured', async () => {
    const mcp = makeMcp({ authorizationServers: ['https://auth.example.com'] });
    const res = await mcp.fetch(new Request(`${PUBLIC_URL}/.well-known/oauth-protected-resource`));
    const body = await res.json() as { authorization_servers: string[] };
    expect(body.authorization_servers).toEqual(['https://auth.example.com']);
  });

  it('points at itself by default - the deployment hosting its own oauth2 server', () => {
    expect(protectedResourceMetadata(PUBLIC_URL)).toEqual({
      resource: `${PUBLIC_URL}/mcp`,
      authorization_servers: [PUBLIC_URL],
      bearer_methods_supported: ['header'],
    });
  });
});

describe('dynamic client registration (intentionally absent)', () => {
  it('does not serve POST /oauth2/register - the oauth2 module is single-client', async () => {
    // Pins the documented seam: when contentia/server/oauth2 grows RFC 7591
    // registration, it will be served on the composed app, not invented here.
    const res = await makeMcp().fetch(new Request(`${PUBLIC_URL}/oauth2/register`, { method: 'POST' }));
    expect(res.status).toBe(404);
  });
});

describe('/mcp bearer gate', () => {
  it('401s an unauthenticated request WITH the resource_metadata discovery pointer', async () => {
    const res = await makeMcp().fetch(new Request(`${PUBLIC_URL}/mcp`, { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    const body = await res.json() as { errors: { status: string }[] };
    expect(body.errors[0]?.status).toBe('401');
  });

  it('401s an invalid bearer token', async () => {
    const res = await makeMcp().fetch(
      new Request(`${PUBLIC_URL}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer never-issued' } }),
    );
    expect(res.status).toBe(401);
  });

  it('fails closed when the bearer gate throws', async () => {
    const mcp = makeMcp({
      verifyBearer: () => {
        throw new Error('session store down');
      },
    });
    const res = await mcp.fetch(
      new Request(`${PUBLIC_URL}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer valid-token' } }),
    );
    expect(res.status).toBe(401);
  });

  it('serves an MCP initialize round-trip for a valid bearer', async () => {
    const res = await makeMcp().fetch(
      new Request(`${PUBLIC_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('contentia');
  });

  it("answers a tools/call with no prior initialize, forwarding the caller's bearer", async () => {
    // Stateless: every HTTP request gets a fresh server, so a client's
    // tools/call arrives without the initialize that preceded it.
    const seen: Request[] = [];
    const mcp = makeMcp({
      fetch: async request => {
        seen.push(request);
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    const res = await mcp.fetch(
      new Request(`${PUBLIC_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'api_request', arguments: { method: 'GET', path: '/api/documents/records' } },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('HTTP 200');
    expect(seen).toHaveLength(1);
    expect(new URL((seen[0] as Request).url).toString()).toBe(`${PUBLIC_URL}/api/documents/records`);
    expect((seen[0] as Request).headers.get('Authorization')).toBe('Bearer valid-token');
  });
});

describe('composition', () => {
  it('404s unknown paths with a JSON:API error body so mis-mounting surfaces clearly', async () => {
    const res = await makeMcp().fetch(new Request(`${PUBLIC_URL}/api/documents/records`));
    expect(res.status).toBe(404);
    const body = await res.json() as { errors: unknown[] };
    expect(body.errors).toHaveLength(1);
  });
});
