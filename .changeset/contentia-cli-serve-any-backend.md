---
"@contentia/cli": minor
---

`contentia local serve` can serve any storage backend from the driver registry with `--backend` and
`--backend-options` (or `CONTENTIA_BACKEND_OPTIONS`), not just a local folder. `--port 0` picks a
free port, and `--json` prints machine-readable `listening` / `error` events on stdout for editors
and scripts. `--auth-token` now also reads `CONTENTIA_AUTH_TOKEN`.

`layerStorageServer` now takes a ready-built `repository` instead of `root` / `defaultExtension` /
`serializerRegistry`, plus an optional `onListening(url)` callback. `LocalStorageServerOptions` is
renamed to `StorageServerOptions`.
