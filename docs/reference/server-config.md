# Server Config

`contentia serve --config` runs the Contentia API from a single config file, with no server code to
write. The config picks the storage backend, how callers authenticate, and what each of them may do.

Need something the config can't express, like a custom `authorize` policy or extra routes? Build the
server in code with [`contentiaApi`](../guides/api-server) instead.

## Quick start

```yaml
# contentia.yaml
storage:
  backend: fs
  options:
    root: ./content
    defaultExtension: json
auth:
  apiKeys:
    - name: importer
      sha256: ${env:IMPORTER_KEY_SHA256}
      scopes: [content:read, content:write]
```

```bash
export IMPORTER_KEY=$(openssl rand -base64 32)
export IMPORTER_KEY_SHA256=$(printf %s "$IMPORTER_KEY" | sha256sum | cut -d' ' -f1)

npx @contentia/cli serve --config contentia.yaml

curl -H "X-API-Key: $IMPORTER_KEY" http://localhost:8080/api/storage/atoms
```

The server needs Node 24 and listens on `127.0.0.1:8080` unless the config sets `listen`.

`--check` builds every repository without starting the server, which is handy in CI or as a
pre-deploy step:

```bash
npx @contentia/cli serve --config contentia.yaml --check
```

## Config reference

| Setting                 | Default      | Description                                                                                             |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `listen.host`           | `127.0.0.1`  | Interface to bind. The `CONTENTIA_LISTEN_HOST` environment variable replaces the default.               |
| `listen.port`           | `8080`       | Port to listen on.                                                                                      |
| `listen.trustedProxies` | none         | IPs or CIDR ranges of your reverse proxies. See [Behind a reverse proxy](#behind-a-reverse-proxy).      |
| `basePath`              | `/api`       | Prefix for every endpoint: `/api/documents`, `/api/storage`, `/api/assets`, `/api/health`.              |
| `storage`               | required     | `backend` plus its `options`. See [Choosing a backend](#choosing-a-backend).                            |
| `catalog`               | `convention` | Where collection settings come from: `convention`, or `decap` to read a Decap config stored in storage. |
| `assets`                | `true`       | Serve the `/assets` endpoint (the media library).                                                       |
| `cors`                  | off          | `origins` (a list, or `'*'`) and optional `maxAge`. Needed when a browser app on another origin calls.  |
| `auth`                  | required     | `oidc`, `login` and/or `apiKeys`. See [Authentication](#authentication).                                |

Unknown settings are an error, so a typo such as `apikeys:` fails at startup instead of silently
switching something off.

For the Decap catalog, `catalog: { provider: decap, configKey: admin/config }` reads
`admin/config.yml` (or `.yaml` / `.json`) from the storage backend. `configKey` defaults to
`config`.

## Secrets

Any string value can reference a secret. References are resolved after the file is parsed, so a
secret's contents can never change the structure of the config.

| Reference                 | Resolves to                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `${env:NAME}`             | The environment variable. Unset or empty is an error.                                                        |
| `${env:NAME:-fallback}`   | The environment variable, or `fallback` when it is unset or empty.                                           |
| `${file:/path/to/secret}` | The file's contents, minus one trailing newline. Relative paths resolve against the config file's directory. |
| `$${`                     | A literal `${`.                                                                                              |

That covers every common secret store without Contentia talking to any of them: Kubernetes Secrets,
External Secrets Operator, the Vault Agent injector, the Secrets Store CSI driver and Docker secrets
all deliver secrets as environment variables or mounted files.

```yaml
storage:
  backend: github
  options:
    owner: acme
    repo: site
    branch: main
    appId: ${env:GITHUB_APP_ID}
    installationId: ${env:GITHUB_INSTALLATION_ID}
    privateKey: ${file:/run/secrets/github/private-key.pem}
```

Errors name the setting (`storage.options.privateKey: secret file … does not exist`), never the
value.

## Choosing a backend

`storage.backend` accepts any backend listed by `contentia local list-backends`, with that backend's
options (see the [adapter pages](../adapters/)). Switching backends is a config change.

The server never installs packages at startup. Every backend is built in except S3, which needs
`@aws-sdk/client-s3` installed next to the CLI.

## Authentication

Configure your OAuth / OIDC provider, API keys, a few test users, or any mix. A server with none of
them refuses to start.

Every caller ends up with a set of scopes, and each request needs one:

| Scope                        | Grants                                      |
| ---------------------------- | ------------------------------------------- |
| `content:read`               | Reading documents, storage and locks        |
| `content:write`              | Creating, updating, deleting and publishing |
| `media:read` / `media:write` | The same for `/assets`                      |
| `admin` (or `*`)             | Everything                                  |

Without a matching scope the request gets `403`. Any authenticated caller may read `/session`.

### Your OAuth / OIDC provider

Point Contentia at the provider you already use (Keycloak, Entra ID, Auth0, Okta, Zitadel, Dex, …)
and it verifies the access tokens that provider issues.

```yaml
auth:
  oidc:
    issuer: https://login.acme.com/realms/acme
    audience: contentia
    rolesClaim: realm_access.roles
    roles:
      cms-admin: [admin]
      cms-editor: [content:read, content:write, media:read, media:write]
      cms-viewer: [content:read, media:read]
```

| Setting                 | Description                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `issuer`                | Must equal the token's `iss` exactly (mind trailing slashes). `https`, or `http` for localhost only.                |
| `audience`              | One or more values; the token's `aud` must contain one. Tokens minted for other apps at your provider are rejected. |
| `rolesClaim`            | Claim holding the user's roles or groups. Exact names (`https://acme.com/roles`) and dot paths both work.           |
| `roles`                 | Role name → scopes.                                                                                                 |
| `defaultScopes`         | Scopes every valid token gets, e.g. `[content:read]`.                                                               |
| `scopesClaim`           | Also grant the scopes listed in this claim (usually `scope` or `scp`). Off by default, see below.                   |
| `jwksUri`               | Signing keys location. Defaults to `jwks_uri` from the issuer's `/.well-known/openid-configuration`.                |
| `algorithms`            | Accepted signing algorithms. Default: RS256/384/512, PS256/384/512, ES256/384/512, EdDSA. HMAC is never accepted.   |
| `clockToleranceSeconds` | Allowed clock skew for `exp` / `nbf`. Default `60`.                                                                 |

Prefer `roles` over `scopesClaim`. In a public client such as a browser admin UI, the user composes
the authorize request and can ask for any scope your provider offers, so a scope in the token only
says what the client asked for. Turn on `scopesClaim` only if your provider restricts those scopes
per user.

Where common providers put roles:

| Provider | `rolesClaim`                                                         |
| -------- | -------------------------------------------------------------------- |
| Keycloak | `realm_access.roles` (or `resource_access.<client>.roles`)           |
| Entra ID | `roles` (app roles)                                                  |
| Auth0    | The namespaced claim your Action adds, e.g. `https://acme.com/roles` |
| Zitadel  | `urn:zitadel:iam:org:project:roles`                                  |

Your provider must issue JWT access tokens with an audience. Access tokens are limited to 2048
characters, so emit roles rather than every group a user belongs to.

Signing keys are cached for 10 minutes. A token signed with an unknown key ID triggers a refetch (at
most every 30 seconds), so key rotation needs no restart, and the last good keys keep working while
the provider is unreachable.

### API keys

For build pipelines, importers and other machine-to-machine callers. Only the SHA-256 of each key
goes in the config, so the config itself isn't a secret.

```yaml
auth:
  apiKeys:
    - name: site-build
      sha256: 3f5a…   # printf %s "$KEY" | sha256sum
      scopes: [content:read, media:read]
```

Generate keys randomly (`openssl rand -base64 32`): a hash only protects a key that can't be
guessed. Callers send the key as `X-API-Key: <key>` or `Authorization: ApiKey <key>`, never in the
URL.

### Users in the config file (for testing)

For trying Contentia out, or a demo, without setting up a provider: list users in the config and the
server runs its own login page.

```yaml
auth:
  login:
    redirectUris: [http://localhost:5173/admin/]
    users:
      - email: editor@example.com
        name: Editor
        passwordHash: ${env:EDITOR_PASSWORD_HASH}
        scopes: [content:read, content:write, media:read, media:write]
```

Generate each `passwordHash` with `hash-password`. It asks for the password twice without echoing
it, or reads it from stdin when piped:

```bash
npx @contentia/cli hash-password
```

A bcrypt hash contains `$` signs, so wrap it in single quotes on the command line
(`export EDITOR_PASSWORD_HASH='$2b$12$…'`).

| Setting        | Description                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `redirectUris` | The admin UI pages that may receive a login, matched exactly. Anything else is refused.              |
| `clientId`     | The client ID the admin UI sends. Default `contentia`.                                               |
| `users`        | `email`, optional `name`, `passwordHash` (bcrypt, cost 12 or more) and `scopes`. Emails ignore case. |

Point the admin UI's OAuth (PKCE) settings at the server: authorize at `/oauth2/authorize` and token
at `/oauth2/token`, with form-encoded token requests. For Decap that is `base_url` (the server's
URL), `auth_endpoint: oauth2/authorize`, `auth_token_endpoint: oauth2/token`,
`auth_token_endpoint_content_type: application/x-www-form-urlencoded` and `app_id` (the `clientId`).
Add the admin's origin to `cors.origins` as well, so it can call the API after signing in. Behind a
proxy that terminates TLS, set [`listen.trustedProxies`](#behind-a-reverse-proxy) so the login form
posts back over https.

Each user gets exactly the scopes listed here, whatever scopes the client asks for. Logins live in
the server's memory: a restart signs everyone out, and a login only works on the replica that issued
it. The server warns about this at startup. In production, use your own provider.

## Running in production

- **Health checks:** `GET <basePath>/health` needs no credentials.
- **Logs:** rejected credentials log as one-line warnings; server errors keep their stack trace.
- **Replicas:** the "being edited by …" locks live in the server process, so editors only see each
  other's locks when they reach the same replica. Run a single replica if you rely on them.

### Behind a reverse proxy

The server builds some URLs from the request: pagination links, the OpenAPI `servers` entry and the
login pages. Behind a proxy that terminates TLS, the server itself only sees plain http from the
proxy, so those URLs come out as `http://` unless it knows which scheme and host the client used.
List your proxies' addresses and the server takes them from the proxy's `X-Forwarded-Proto` and
`X-Forwarded-Host` headers:

```yaml
listen:
  host: 0.0.0.0
  trustedProxies: [10.0.0.0/8] # the network your ingress or load balancer connects from
```

Entries are single addresses (`10.0.0.7`, `::1`) or CIDR ranges (`172.16.0.0/12`, `fd00::/8`). One
comma-separated string works too, so a single `${env:TRUSTED_PROXIES}` can carry several.

Without `trustedProxies` the server ignores every `X-Forwarded-*` header, since any client can send
them. With it, the headers count only on connections from a listed address, and only like this:

- The proxy has to append the client's address to `X-Forwarded-For`. nginx does with
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`; Caddy, Traefik and ingress-nginx do
  by default.
- `X-Forwarded-Proto` and `X-Forwarded-Host` are used only when they hold one value per
  `X-Forwarded-For` entry. A single proxy gets this right. With a chain of proxies (a CDN in front
  of a load balancer, say), list all of them and have each one append to `X-Forwarded-Proto` too. A
  proxy that overwrites it with a single value makes the server fall back to the scheme it sees
  itself. Without `X-Forwarded-Host`, the `Host` header the proxy forwards is used.
