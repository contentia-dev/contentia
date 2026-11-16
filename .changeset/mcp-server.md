---
"contentia": minor
"@contentia/cli": minor
---

Add `contentia/server/mcp`, an MCP server that exposes the Contentia API to AI agents with two
tools: `read_api_spec` (an index of the OpenAPI spec, then the full contract for selected
operations) and `api_request` (a request to the JSON:API with the caller's own token).
`contentiaMcp` mounts it over Streamable HTTP next to `contentiaApi`; the CLI's new
`contentia local mcp` command runs it over stdio. `@modelcontextprotocol/sdk` is a new optional peer
dependency.

**Breaking:** `contentia/server/ai` (`decapAi`, `AiSessionCallbacks`, the AI chat and session
endpoints) is removed, along with the optional `ai` and `@ai-sdk/*` peer dependencies.

The storage, documents, assets, and catalog API entry points now re-export their OpenAPI builders by
name. Calling a builder such as `buildStorageOpenApi()` from an esbuild bundle (wrangler, tsup) no
longer crashes.
