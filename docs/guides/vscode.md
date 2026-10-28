# VS Code Extension

Browse Contentia content from the editor: storage folders and objects, and document collections with
their published and unpublished records. Click an object or record to open it as read-only JSON.

> **Early access.** The extension is not yet published to the VS Code Marketplace. Install it from
> source or a `.vsix` file while it is pre-release.

## Connection types

The extension supports two kinds of connections.

| Type       | How it connects                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **local**  | Starts `contentia local serve` through the workspace's own `@contentia/cli`. Provides a Storage tree.                                   |
| **remote** | Talks to a deployed Contentia API server over JSON:API. Provides Storage and/or Documents trees depending on which URLs are configured. |

Both types browse content through the same JSON:API proxy, so the tree UI is identical for local and
remote connections.

## Configuration

Add a `contentia.connections` array to your workspace or user settings:

```jsonc
// .vscode/settings.json
{
  "contentia.connections": [
    {
      "name": "Content",
      "type": "local",
      "backend": "fs",
      "options": { "root": "content" }
    },
    {
      "name": "Production",
      "type": "remote",
      "storageUrl": "https://cms.example.com/api/storage",
      "documentsUrl": "https://cms.example.com/api/documents"
    }
  ]
}
```

### Local connection options

| Field     | Type                | Description                                                                                                             |
| --------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `name`    | `string`            | Display name shown in the tree. Must be unique.                                                                         |
| `type`    | `"local"`           | Identifies a local connection.                                                                                          |
| `backend` | `string` (optional) | Backend name passed to `contentia local serve` (e.g. `"fs"`).                                                           |
| `options` | `object` (optional) | Backend-specific options (e.g. `{ "root": "content" }`). A relative `root` resolves against the first workspace folder. |

### Remote connection options

| Field          | Type                | Description                                                                        |
| -------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `name`         | `string`            | Display name shown in the tree. Must be unique.                                    |
| `type`         | `"remote"`          | Identifies a remote connection.                                                    |
| `storageUrl`   | `string` (optional) | Base URL of the deployed Storage API (e.g. `https://cms.example.com/api/storage`). |
| `documentsUrl` | `string` (optional) | Base URL of the deployed Documents API. Required for the Documents tree.           |

`contentia local serve` exposes only the Storage API, so local connections never show a Documents
tree. Remote connections show whichever trees have a URL configured.

## Authentication

Remote connections send a bearer token when one is set (requests go unauthenticated otherwise). Set
it with the **Contentia: Set Access Token** command — VS Code stores it in its secret storage, never
in settings or on disk.

Local connections generate a random token internally; no configuration is needed.

## CLI resolution

For local connections, the extension runs the project's own `@contentia/cli`. Resolution order:

1. The `contentia.cli.path` setting (absolute path to the CLI binary).
2. The `CONTENTIA_CLI_PATH` environment variable.
3. `node_modules/.bin/contentia` in the first workspace folder that has one.
4. `npx @contentia/cli` (fallback).

CLI output and recoverable warnings appear in the **Contentia** output channel.
