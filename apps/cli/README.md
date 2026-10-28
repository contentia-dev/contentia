# @contentia/cli

The Contentia command-line interface. The package is `@contentia/cli` and its bin is `contentia`.
Without installing anything, run it as `npx @contentia/cli` or `pnpm dlx @contentia/cli`.

## Install

```sh
pnpm add -D @contentia/cli   # or npm i -D / yarn add -D
```

Then:

```sh
contentia create                      # wizard: starter, directory, title, CMS + its backends/widgets/locales
contentia local serve                 # serve a storage backend (local files by default) over JSON:API
contentia local generate              # config.yaml -> typed config.gen.ts (add --watch to keep it fresh)
contentia local migrate -s ./a -d ./b # copy a storage repository to another backend
contentia local list-backends         # show every registered storage backend
```

Or one-off without installing:

```sh
npx @contentia/cli local serve
pnpm dlx @contentia/cli local serve
```

## Commands

All local-file dev tooling lives under the `local` namespace; the top level is reserved for future
non-local commands.

| Command               | What it does                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `create`              | Wizard that bootstraps a starter app and generates its `src/cms.ts` from your backend/widget/locale selection                             |
| `local serve`         | JSON:API storage server for dev workflows: local files (`--root`) or any backend (`--backend`, `--backend-options`); `--json` for editors |
| `local generate`      | Generate a typed TypeScript module from the CMS config file (`--input/-i`, `--output/-o`, `--watch/-w`, `--cms`)                          |
| `local migrate`       | Copy every atom from one storage repository to another (fs, webdav, s3, github, gitlab, bitbucket, …); see flags below                    |
| `local list-backends` | List every registered storage backend and its pinned package version                                                                      |

Run `contentia local <command> --help` for the full flag reference.

### `create` — the wizard

`contentia create` is the supported way to start a Contentia app — always go through it rather than
copying a starter folder. On a terminal it walks through every choice: the starter template, target
directory, site title, package manager, and — because every starter boots the **bare, non-contentia
Decap app** (`@laikacms/decap-cms/laika-app/bare`) with nothing pre-registered — which CMS
**backends**, **widgets**, and extra admin UI **locales** to install. The selection is written to
the generated app's `src/cms.ts`; re-run the wizard or edit that file to change it later.

Each prompt can be pre-answered with a flag, which also makes the command scriptable:

```sh
contentia create --starter starter-hono-blog --name my-blog --directory ./my-blog \
  --title "My Blog" --package-manager npm \
  --backends contentia --widgets string,datetime,richtext --locales nl,de
contentia create --yes   # accept all defaults, no prompts (also the no-TTY behavior)
contentia create --skip-install  # scaffold the app without running pnpm install
```

| Flag                 | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `--directory` / `-d` | Target directory (default: `./my-contentia-app`; wizard asks)                               |
| `--starter`          | Starter template to use (default: first in list; wizard asks when >1 exists)                |
| `--name`             | `package.json` `name` field (default: directory name)                                       |
| `--title`            | Site title written to the starter (default: `My Blog`; wizard asks)                         |
| `--package-manager`  | `pnpm` / `npm` / `yarn` / `bun` (default: `pnpm`; wizard asks)                              |
| `--skip-install`     | Scaffold the app without installing dependencies                                            |
| `--cms`              | CMS adapter to use (default: `decap`; wizard skips while only one exists)                   |
| `--backends`         | Comma-separated backends to register (wizard asks; adapter-specific)                        |
| `--widgets`          | Comma-separated widgets to register (wizard asks; adapter-specific)                         |
| `--locales`          | Comma-separated extra admin UI locales (`en` is built in; wizard asks)                      |
| `--yes` / `-y`       | Accept all defaults and skip wizard prompts (also activated when stdin/stdout is not a TTY) |

### Which CMS

The admin UI is a plug-in choice, selected with `--cms`. Decap is the only one today, so the wizard
skips the question and uses it — the same way it skips the starter question while one starter is
enabled. Each CMS owns its own catalogs, so `--backends`, `--widgets`, and `--locales` are always
read against the selected CMS, and `contentia local generate` reads that CMS's config format.

Adding one means writing a sibling of `src/cms/decap.ts` that implements `CmsAdapter`
(`src/cms/types.ts`) and listing it in `src/cms/registry.ts`; nothing outside that folder knows what
a Decap import looks like. Note that a CMS **backend** (a content source the admin UI talks to) is a
different axis from a **storage backend** (`local migrate`, `local list-backends`).

### `local serve` — storage server

Starts a JSON:API HTTP server in front of a storage backend. The default is a local filesystem
backend rooted at the current directory; pass `--backend` to use any registered backend instead.

```sh
contentia local serve                              # serve ./cwd over JSON:API on port 3030
contentia local serve --root ./content --port 4000
contentia local serve --backend github --backend-options '{"owner":"acme","repo":"content","branch":"main","token":"ghp_..."}'
contentia local serve --json                       # machine-readable output (VS Code extension)
```

| Flag                  | Alias | Description                                                                                                        |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `--root`              | `-r`  | FS shortcut: root directory to serve (default: cwd)                                                                |
| `--port`              | `-p`  | Listen port; `0` picks a free one (default: `3030`)                                                                |
| `--host`              | `-H`  | Listen host (default: `127.0.0.1`)                                                                                 |
| `--default-extension` | —     | FS shortcut: default file extension for new objects (default: `md`)                                                |
| `--auth-token`        | —     | Require `Authorization: Bearer <token>` on every request (or set `CONTENTIA_AUTH_TOKEN`)                           |
| `--backend`           | —     | Storage backend to serve (e.g. `fs`, `s3`, `github`). See `list-backends`. Default: `fs` on `--root`               |
| `--backend-options`   | —     | JSON-encoded options for `--backend` (or set `CONTENTIA_BACKEND_OPTIONS` to keep credentials off the process list) |
| `--json`              | —     | Print machine-readable JSON lines on stdout (for editors and scripts); never prompts to install packages           |

### `local generate` — config codegen

Reads the CMS config file (Decap's `config.yaml` by default) and writes a typed TypeScript module
that exposes the config as an `as const` value with inferred literal types.

```sh
contentia local generate              # auto-discover config.yaml, write config.gen.ts next to it
contentia local generate --watch      # regenerate on every save
contentia local generate -i src/config.yaml -o src/config.gen.ts
```

| Flag       | Alias | Description                                                                                             |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `--input`  | `-i`  | Path to the CMS config file (default: auto-discover `./config.{yml,yaml}` or `./src/config.{yml,yaml}`) |
| `--output` | `-o`  | Path to the generated `.ts` (default: `config.gen.ts` next to the input file)                           |
| `--watch`  | `-w`  | Regenerate whenever the input file changes                                                              |
| `--cms`    | —     | CMS whose config format to read (default: `decap`)                                                      |

### `local migrate` — copy between backends

Copies every atom (folder + object) from one storage repository to another. Three input modes:

```sh
# FS shortcut (most common for local dev)
contentia local migrate -s ./content -d ./backup

# Named backends (cross-backend: fs → github, webdav → s3, etc.)
# PAT / fine-grained token:
contentia local migrate \
  --source-backend fs --source-options '{"root":"./content"}' \
  --destination-backend github \
  --destination-options '{"owner":"acme","repo":"content","branch":"main","token":"ghp_..."}'

# GitHub App credentials (appId + privateKeyPath + installationId):
contentia local migrate \
  --source-backend fs --source-options '{"root":"./content"}' \
  --destination-backend github \
  --destination-options '{"appId":"123","privateKeyPath":"/path/to/app.pem","installationId":"456","owner":"acme","repo":"content","branch":"main"}'

# Config file
contentia local migrate --config migrate.yaml
```

| Flag                    | Alias | Description                                                                  |
| ----------------------- | ----- | ---------------------------------------------------------------------------- |
| `--config`              | `-c`  | Path to a JSON/YAML `{source, destination, migrate?}` config file            |
| `--source-backend`      | —     | Source backend name (e.g. `fs`, `vercel`, `surrealdb`). See `list-backends`. |
| `--source-options`      | —     | JSON-encoded options object for the source backend                           |
| `--destination-backend` | —     | Destination backend name                                                     |
| `--destination-options` | —     | JSON-encoded options object for the destination backend                      |
| `--source`              | `-s`  | FS shortcut: source root directory                                           |
| `--destination`         | `-d`  | FS shortcut: destination root directory                                      |
| `--from`                | —     | Folder key to start the migration from (default: `''`, the root)             |
| `--overwrite`           | —     | Overwrite objects that already exist on the destination                      |
| `--dry-run`             | —     | Walk the source and log what would happen without writing anything           |
| `--concurrency`         | —     | Parallel copies per folder (default: `4`)                                    |
| `--page-size`           | —     | List page size on the source (default: `1000`)                               |
| `--no-install`          | —     | Refuse to auto-install missing backend packages (fail instead)               |

## Programmatic API

Everything the CLI does is also exported from the package root (`layerStorageServer`,
`generateConfig`, `runMigrate`, the storage driver registry, and the `make*Command` factories for
embedding the subcommands in another Effect CLI):

```ts
import { layerStorageServer } from '@contentia/cli';
```

> This package supersedes `@contentia/local`, which is deprecated.
