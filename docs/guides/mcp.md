# MCP Server

Contentia is a useful data access layer for LLMs: one API over every backend, described by an
OpenAPI spec. [`contentia/server/mcp`](../reference/api/contentia/server/mcp/) exposes that API to
AI agents over the [Model Context Protocol](https://modelcontextprotocol.io) with just two tools,
because the API is the product:

| Tool            | What it does                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_api_spec` | Reads the OpenAPI spec. With no arguments it returns a compact index of every operation; with `paths`, `tag`, or `search` it returns the full contract for just those.          |
| `api_request`   | Sends a request to the JSON:API with the caller's own token. Only paths under the API's base path are allowed, and the API's authentication and `authorize` policy apply as is. |

The MCP layer adds no authority of its own: an agent can do exactly what the token it connects with
can do through the API.

## Mount it next to the API

```bash
pnpm add contentia @modelcontextprotocol/sdk
```

The MCP SDK is an optional peer of `contentia`: only apps that import `contentia/server/mcp` need
it.

```typescript
// mcp.ts
import { buildContentiaApiOpenApi, contentiaMcp } from 'contentia/server/mcp';
import { api } from './contentia.js';

export const mcp = contentiaMcp({
  publicUrl: 'https://cms.example.com',
  apiBasePath: '/api',
  fetch: api.fetch,
  openApi: buildContentiaApiOpenApi({ basePath: '/api' }),
  // An MCP caller needs the same token an API caller does.
  verifyBearer: async (_authorization, request) => {
    const result = await api.authenticateRequest(request);
    return result instanceof Response ? null : result;
  },
});
```

`api` is the [`contentiaApi`](./api-server) handler. `mcp.fetch` answers three paths: `/mcp` and the
two `/.well-known/oauth-protected-resource` discovery documents. Send those to it, ahead of any
catch-all route, and everything else to the API:

```typescript
const fetch = (request: Request) => {
  const { pathname } = new URL(request.url);
  return pathname === '/mcp' || pathname.startsWith('/.well-known/oauth-protected-resource')
    ? mcp.fetch(request)
    : api.fetch(request);
};
```

In a framework, add routes for those paths the way [Mount the API](./api-server#mount-the-api) adds
`/api/*`. Each request gets its own short-lived MCP server, so it scales like the API: any instance
can answer any request.

### Options

| Option                 | Required | Description                                                                                                     |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `publicUrl`            | yes      | Public origin of the deployment, e.g. `'https://cms.example.com'`                                               |
| `apiBasePath`          | no       | The `basePath` the API was built with. `api_request` only reaches paths under it                                |
| `fetch`                | yes      | Where `api_request` sends requests, usually `api.fetch` (in-process, no network hop)                            |
| `openApi`              | yes      | The spec `read_api_spec` serves; `buildContentiaApiOpenApi` builds it for `contentiaApi`                        |
| `verifyBearer`         | yes      | Returns the caller for a valid `Authorization` header, or `null` to answer `401`. Throwing also answers `401`   |
| `authorizationServers` | no       | Authorization servers advertised in the discovery document. Defaults to `publicUrl`                             |
| `serverInfo`           | no       | Name and version reported to MCP clients. Defaults to `contentia`                                               |
| `instructions`         | no       | Replaces the default usage instructions sent to the model                                                       |
| `maxToolResponseChars` | no       | Truncates `api_request` responses longer than this (default 100 000), so one large listing can't fill a context |

`buildContentiaApiOpenApi({ basePath, assets })` combines the documents, storage, and (unless
`assets: false`) assets specs under their `contentiaApi` paths. To describe another API, such as a
catalog API you mount yourself, combine specs with `combineOpenApiDocuments`.

### Connecting a client

An MCP client connects to `https://cms.example.com/mcp` with a token the API accepts in its
`Authorization` header, for example a [personal access token](./api-server#personal-access-tokens).

A request without a valid token gets a `401` whose `WWW-Authenticate` header points at
`/.well-known/oauth-protected-resource/mcp`, which names the authorization server. That is the start
of the OAuth sign-in flow MCP clients support, but the bundled
[login server](./api-server#add-the-login-server) can't finish it yet: it publishes no
authorization-server metadata and has no dynamic client registration. Until it does, configure the
client with a token.

## Run it locally over stdio

The CLI runs the same two tools over stdio, for desktop clients and coding agents on your machine:

```bash
npx @contentia/cli local mcp --root ./content
```

By default it serves the storage API over the local folder, in-process, with no port and no auth:
whoever can start the process can read the files anyway. `--backend` and `--backend-options` pick
another storage backend, as in `contentia local serve`. To work against a deployment instead, pass
its API URL and a token:

```bash
npx @contentia/cli local mcp --base-url https://cms.example.com/api --auth-token "$CONTENTIA_TOKEN"
```

Most MCP clients take a server definition like this one:

```json
{
  "mcpServers": {
    "contentia": {
      "command": "npx",
      "args": ["@contentia/cli", "local", "mcp", "--root", "/path/to/content"]
    }
  }
}
```

## Building blocks

[`createContentiaMcpServer`](../reference/api/contentia/server/mcp/functions/createContentiaMcpServer)
builds the two-tool server without a transport, so you can connect it to any transport the MCP SDK
offers; `contentiaMcp` and the CLI are both thin wrappers around it.
[`readApiSpec`](../reference/api/contentia/server/mcp/functions/readApiSpec) is the index-or-slice
logic behind `read_api_spec`, usable on any OpenAPI 3.1 document.
