# Laika CMS for VS Code

Browse Laika content from the editor: storage folders and objects, and document collections with
their published and unpublished records. Click an object or record to open it as read-only JSON.

> Early work in progress. Not published to the Marketplace yet.

## How it works

The extension runs the CLI for the server and talks JSON:API for the data:

- A **local** connection starts `laika local serve --json --port 0` through the workspace's own
  `laikacli`, so it always matches the project's CLI version and storage backends. It waits for the
  `listening` event, then browses the server over JSON:API. Each server gets a random bearer token;
  the token and backend options travel through environment variables, not argv.
- A **remote** connection talks to a deployed Laika API server directly. Its bearer token is kept in
  VS Code's secret storage (**Laika: Set Access Token**), never in settings.

Both kinds browse through the same `laikacms` JSON:API proxy repositories. Recoverable warnings and
CLI output go to the **Laika** output channel.

Which `laikacli` runs, in order: the `laika.cli.path` setting, the `LAIKA_CLI_PATH` env var, the
first workspace folder's `node_modules/.bin/laika`, then `npx laikacli`.

## Configuration

```jsonc
// .vscode/settings.json
{
  "laika.connections": [
    { "name": "Content", "type": "local", "backend": "fs", "options": { "root": "content" } },
    {
      "name": "Production",
      "type": "remote",
      "storageUrl": "https://cms.example.com/api/storage",
      "documentsUrl": "https://cms.example.com/api/documents"
    }
  ]
}
```

A relative `fs` root resolves against the first workspace folder. `laika local serve` only exposes
the Storage API, so the Documents view lists remote connections that have a `documentsUrl`.

## Development

The extension and the CLI are developed together; the extension always runs the local CLI build.

1. `pnpm install` at the repo root.
2. Run `pnpm dev` (or `pnpm turbo watch dev --filter laika-vscode...`) to rebuild the extension, the
   CLI and `laikacms` on change.
3. Start the **Laika VS Code extension** launch config (F5). It builds once, then opens
   `fixtures/playground` in an Extension Development Host.

The playground is a workspace package that depends on `laikacli: workspace:*`, so its
`node_modules/.bin/laika` is the local `apps/cli` build, and the extension finds it the same way it
finds a user's install. The launch config also sets `LAIKA_CLI_PATH` to `apps/cli/dist/cli.js`, so
any other folder opened in the dev host uses the local CLI too.

After a change:

- **CLI**: run **Laika: Restart Local Servers**; no window reload needed.
- **Extension**: run **Developer: Reload Window** in the dev host.
- **`laikacms`**: both bundle it, so do both.

Tests: `pnpm --filter laika-vscode test`. Besides unit tests, `serve-process.test.ts` starts the
real `apps/cli/dist/cli.js` and browses it through the JSON:API proxy, so a change to the
`serve --json` contract that the extension can't read fails there. Build the CLI first
(`turbo run test` does).
