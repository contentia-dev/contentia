---
"@contentia/cli": minor
---

Add `contentia serve --config <file>`: runs the Contentia API (documents, storage, assets) from one
YAML/JSON config. The config chooses the storage backend, reads secrets via `${env:…}` /
`${file:…}`, verifies access tokens from your own OAuth/OIDC provider, accepts SHA-256-hashed API
keys, and authorizes with the shared scope policy. For testing, `auth.login` lists users in the
config and serves a login page (sessions in memory); `contentia hash-password` makes their password
hashes. `--check` validates a config without listening. `CONTENTIA_LISTEN_HOST` sets the default
listen host.
