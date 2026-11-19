# contentia

## 0.1.0-alpha.2

### Minor Changes

- 5ff5154: Storage repositories no longer depend on minimatch. `ignoreList` patterns are now matched
  by a built-in matcher that doesn't use regular expressions, so no pattern can make it backtrack
  exponentially. It's also exported as `compileIgnoreList` from `contentia/storage`, for custom
  storage repositories.

  **Breaking:** an `ignoreList` pattern that uses character classes (`[abc]`), extglobs (`@(a|b)`),
  brace ranges (`{1..3}`), nested braces, or negation (`!pattern`) now throws when the repository is
  constructed. A pattern for a nested path, such as `drafts/secret.md`, no longer also hides its
  parent folder (`drafts`) from listings.
- fafc1ad: Add `contentia/server/mcp`, an MCP server that exposes the Contentia API to AI agents
  with two tools: `read_api_spec` (an index of the OpenAPI spec, then the full contract for selected
  operations) and `api_request` (a request to the JSON:API with the caller's own token).
  `contentiaMcp` mounts it over Streamable HTTP next to `contentiaApi`; the CLI's new
  `contentia local mcp` command runs it over stdio. `@modelcontextprotocol/sdk` is a new optional
  peer dependency.

  **Breaking:** `contentia/server/ai` (`decapAi`, `AiSessionCallbacks`, the AI chat and session
  endpoints) is removed, along with the optional `ai` and `@ai-sdk/*` peer dependencies.

  The storage, documents, assets, and catalog API entry points now re-export their OpenAPI builders
  by name. Calling a builder such as `buildStorageOpenApi()` from an esbuild bundle (wrangler, tsup)
  no longer crashes.

### Patch Changes

- 1e3c6f6: `CatalogAssetsRepository` now matches a media collection's `accept` list the way its
  schema describes it, as the HTML `accept` attribute does: MIME types (`image/png`), wildcards
  (`image/*`), and file extensions (`.png`, matched against the asset's filename and key), ignoring
  case and MIME type parameters. Before, only an exact MIME type matched, so a collection that
  accepted `image/*` or `.png` turned away every upload.

  `updateAsset` now also checks a changed `mimeType` against the list, so a PATCH can no longer give
  an asset a type its collection doesn't accept.
- Package metadata: `homepage` links to each package's page on contentia.dev instead of the GitHub
  repo, and `repository` names the package's folder in the monorepo. `@contentia/cli` now ships its
  MIT license text.

## 0.0.1-alpha.1

First Contentia release, published under the `alpha` dist-tag. This package continues `laikacms`,
renamed as part of splitting the content API out of Laika CMS. Its history before the rename is in
the git log.
