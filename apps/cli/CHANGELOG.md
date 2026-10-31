# @contentia/cli

## 0.0.1-alpha.1

First Contentia release, published under the `alpha` dist-tag. This package continues `laikacli`,
renamed as part of splitting the content API out of Laika CMS. Its history before the rename is in
the git log.

`laikacli create` and the starter templates it copied stay with Laika: scaffolding a Decap app is a
Laika concern, so this CLI has no `create` command.

Adds `contentia serve --config <file>`: runs the Contentia API (documents, storage, assets) from one
YAML/JSON config. The config chooses the storage backend, reads secrets via `${env:…}` /
`${file:…}`, verifies access tokens from your own OAuth/OIDC provider, accepts SHA-256-hashed API
keys, and authorizes with the shared scope policy. For testing, `auth.login` lists users in the
config and serves a login page (sessions in memory); `contentia hash-password` makes their password
hashes. `--check` validates a config without listening. `CONTENTIA_LISTEN_HOST` sets the default
listen host.
