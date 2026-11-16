# Get Started

Task-oriented walkthroughs for getting Contentia running and wired into your stack.

## Getting up and running

- **[Getting Started](./getting-started)** — the progressive path: read/write content in the
  browser, stand up a secure-by-default server, or compile content at build time for a static site.
- **[API Server](./api-server)** — documents, storage, and assets behind one authenticated endpoint
  with `contentiaApi`; catalog providers; running it on Node.js or the edge; deploying.
- **[Server Config](./server-config)** — run the Contentia API from one config file: any storage
  backend, your own OAuth/OIDC provider, API keys.

## Securing and mounting the API

- **[Authentication](./auth)** — API keys, authorization policies (roles, scopes), personal access
  tokens, SSR guards, logging, and the bundled OAuth2 login server.
- **[Framework setup](./frameworks)** — mount the API in Express, Next.js, SvelteKit, Nuxt,
  AdonisJS, FoalTS, VitePress, Docusaurus, and more.

## Integrations

- **[Astro](./astro)** — use Contentia content through Astro's own Content Layer (`getCollection`,
  `getEntry`, `render`, Zod schemas) with incremental sync and dev-server hot-reload.
- **[Vite](./vite)** — import content as ES modules at build time through the `contentia:` protocol,
  for fully static builds.
- **[MCP Server](./mcp)** — expose the Contentia API to AI agents over the Model Context Protocol
  (`contentia/server/mcp`, or `contentia local mcp`).

## Tools

- **[VS Code Extension](./vscode)** — browse storage folders, objects, and document collections from
  the editor; local and remote connections.
