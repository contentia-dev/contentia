import fs from 'node:fs/promises';
import path from 'node:path';

import { load as loadYaml } from 'js-yaml';

import { isScope, type Scope } from 'contentia/auth';
import { PASSWORD_CONSTANTS } from 'contentia/crypto';

import type { BackendSpec } from '../drivers/types.js';
import { interpolateConfig } from './interpolate.js';
import { isHttpsOrLoopback, isJwtAlgorithm, type JwtAlgorithm } from './oidc.js';

/**
 * The config file behind `contentia serve --config`: which backend to serve,
 * how callers authenticate, and what each of them may do. Values may reference
 * secrets with `${env:…}` / `${file:…}` (see `interpolate.ts`).
 */
export interface ServerConfig {
  readonly listen: { readonly host: string, readonly port: number };
  /** URL prefix for every endpoint, e.g. `/api` → `/api/documents`, `/api/health`. */
  readonly basePath: string;
  readonly cors?: { readonly origins: string[] | '*', readonly maxAge?: number };
  /** Any backend from the driver registry (`contentia local list-backends`). */
  readonly storage: BackendSpec;
  /** Where collection settings come from. */
  readonly catalog: CatalogConfig;
  /** Serve the `/assets` endpoint (media library). */
  readonly assets: boolean;
  readonly auth: AuthConfig;
}

export type CatalogConfig =
  | { readonly provider: 'convention' }
  | { readonly provider: 'decap', readonly configKey: string };

export interface AuthConfig {
  readonly oidc?: OidcConfig;
  readonly login?: LoginConfig;
  readonly apiKeys: readonly ApiKeyConfig[];
}

/**
 * The built-in login page, for testing: the users listed here sign in with a
 * password and get access tokens from this server. Sessions live in memory,
 * so a restart signs everyone out and logins don't carry across replicas.
 */
export interface LoginConfig {
  /** Pages that may receive a login (the admin UI's URL), matched exactly. */
  readonly redirectUris: readonly string[];
  /** The `client_id` the admin UI sends. */
  readonly clientId: string;
  readonly users: readonly LoginUserConfig[];
}

export interface LoginUserConfig {
  /** Lowercase, like what the login form submits. */
  readonly email: string;
  readonly name?: string;
  /** bcrypt hash from `contentia hash-password`. */
  readonly passwordHash: string;
  readonly scopes: readonly Scope[];
}

export interface OidcConfig {
  readonly issuer: string;
  readonly audience: readonly string[];
  readonly jwksUri?: string;
  readonly algorithms?: readonly JwtAlgorithm[];
  readonly clockToleranceSeconds?: number;
  /** Claim holding the user's roles, e.g. `roles`, `groups`, `realm_access.roles`. */
  readonly rolesClaim?: string;
  /** Role name → scopes granted to users with that role. */
  readonly roles: Readonly<Record<string, readonly Scope[]>>;
  /**
   * Claim to read scopes from directly (usually `scope` or `scp`). Off by
   * default: with a public client such as the Decap admin, the user composes
   * the authorize request and can ask for any scope the provider offers, so
   * only trust this when the provider restricts those scopes per user.
   */
  readonly scopesClaim?: string;
  /** Scopes every valid token gets. */
  readonly defaultScopes: readonly Scope[];
}

export interface ApiKeyConfig {
  /** Shown in logs and as the principal's name. */
  readonly name: string;
  /** Lowercase hex SHA-256 of the key. The key itself never goes in the config. */
  readonly sha256: string;
  readonly scopes: readonly Scope[];
}

export const DEFAULT_PORT = 8080;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_BASE_PATH = '/api';
export const DEFAULT_LOGIN_CLIENT_ID = 'contentia';

type Obj = Record<string, unknown>;

/** Reads one config object, refusing keys it doesn't know (a typo in `auth:` must not go unnoticed). */
class Reader {
  constructor(readonly obj: Obj, readonly at: string) {}

  static of(value: unknown, at: string): Reader {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at}: must be an object`);
    return new Reader(value as Obj, at);
  }

  path(key: string): string {
    return this.at === '' ? key : `${this.at}.${key}`;
  }

  allowOnly(...keys: string[]): this {
    for (const key of Object.keys(this.obj)) {
      if (!keys.includes(key)) {
        throw new Error(`${this.path(key)}: unknown setting (expected one of: ${keys.join(', ')})`);
      }
    }
    return this;
  }

  has(key: string): boolean {
    return this.obj[key] !== undefined && this.obj[key] !== null;
  }

  string(key: string): string;
  string(key: string, fallback: string): string;
  string(key: string, fallback?: string): string {
    const value = this.obj[key];
    if (value === undefined || value === null) {
      if (fallback !== undefined) return fallback;
      throw new Error(`${this.path(key)}: required`);
    }
    if (typeof value !== 'string' || value === '') throw new Error(`${this.path(key)}: must be a non-empty string`);
    return value;
  }

  optionalString(key: string): string | undefined {
    return this.has(key) ? this.string(key) : undefined;
  }

  /** Accepts numeric strings too, since `${env:PORT}` always interpolates to a string. */
  integer(key: string, fallback: number, min: number, max: number): number {
    const value = this.obj[key];
    if (value === undefined || value === null) return fallback;
    const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
      throw new Error(`${this.path(key)}: must be an integer between ${min} and ${max}`);
    }
    return n;
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.obj[key];
    if (value === undefined || value === null) return fallback;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error(`${this.path(key)}: must be true or false`);
  }

  stringList(key: string): string[] {
    const value = this.obj[key];
    const list = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(list) || list.length === 0 || list.some(v => typeof v !== 'string' || v === '')) {
      throw new Error(`${this.path(key)}: must be a non-empty string or list of strings`);
    }
    return list as string[];
  }

  scopes(key: string, fallback?: Scope[]): Scope[] {
    if (!this.has(key) && fallback) return fallback;
    const value = this.obj[key];
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
      throw new Error(`${this.path(key)}: must be a list of scopes`);
    }
    for (const scope of value as string[]) {
      if (!isScope(scope)) {
        throw new Error(
          `${this.path(key)}: "${scope}" is not a scope (use resource:action, e.g. content:read, or admin)`,
        );
      }
    }
    return value as Scope[];
  }

  child(key: string): Reader {
    return Reader.of(this.obj[key], this.path(key));
  }
}

const readStorage = (r: Reader): BackendSpec => {
  r.allowOnly('backend', 'options');
  const options = r.has('options') ? r.child('options').obj : {};
  return { backend: r.string('backend'), options };
};

const readCatalog = (value: unknown, at: string): CatalogConfig => {
  if (value === undefined || value === null) return { provider: 'convention' };
  const r = typeof value === 'string' ? new Reader({ provider: value }, at) : Reader.of(value, at);
  r.allowOnly('provider', 'configKey');
  const provider = r.string('provider');
  if (provider === 'convention') {
    if (r.has('configKey')) throw new Error(`${r.path('configKey')}: only applies to the decap provider`);
    return { provider };
  }
  if (provider === 'decap') return { provider, configKey: r.string('configKey', 'config') };
  throw new Error(`${r.path('provider')}: must be "convention" or "decap"`);
};

const readCors = (r: Reader): NonNullable<ServerConfig['cors']> => {
  r.allowOnly('origins', 'maxAge');
  const origins = r.obj.origins === '*' ? '*' : r.stringList('origins');
  const maxAge = r.has('maxAge') ? r.integer('maxAge', 0, 0, 86_400 * 7) : undefined;
  return maxAge === undefined ? { origins } : { origins, maxAge };
};

const readOidc = (r: Reader): OidcConfig => {
  r.allowOnly(
    'issuer',
    'audience',
    'jwksUri',
    'algorithms',
    'clockToleranceSeconds',
    'rolesClaim',
    'roles',
    'scopesClaim',
    'defaultScopes',
  );
  const issuer = r.string('issuer');
  if (!isHttpsOrLoopback(issuer)) {
    throw new Error(`${r.path('issuer')}: must be an https URL (http is only allowed for localhost)`);
  }
  const jwksUri = r.optionalString('jwksUri');
  if (jwksUri !== undefined && !isHttpsOrLoopback(jwksUri)) {
    throw new Error(`${r.path('jwksUri')}: must be an https URL (http is only allowed for localhost)`);
  }
  let algorithms: JwtAlgorithm[] | undefined;
  if (r.has('algorithms')) {
    algorithms = r.stringList('algorithms').map(alg => {
      if (!isJwtAlgorithm(alg)) throw new Error(`${r.path('algorithms')}: "${alg}" is not a supported algorithm`);
      return alg;
    });
  }
  const roles: Record<string, Scope[]> = {};
  if (r.has('roles')) {
    const rolesReader = r.child('roles');
    for (const role of Object.keys(rolesReader.obj)) roles[role] = rolesReader.scopes(role);
  }
  const rolesClaim = r.optionalString('rolesClaim');
  if (Object.keys(roles).length > 0 && rolesClaim === undefined) {
    throw new Error(`${r.path('roles')}: set rolesClaim to say which token claim holds the roles`);
  }
  return {
    issuer,
    audience: r.stringList('audience'),
    roles,
    defaultScopes: r.scopes('defaultScopes', []),
    ...(jwksUri !== undefined && { jwksUri }),
    ...(algorithms !== undefined && { algorithms }),
    ...(r.has('clockToleranceSeconds') && { clockToleranceSeconds: r.integer('clockToleranceSeconds', 60, 0, 600) }),
    ...(rolesClaim !== undefined && { rolesClaim }),
    ...(r.has('scopesClaim') && { scopesClaim: r.string('scopesClaim') }),
  };
};

const readApiKeys = (value: unknown, at: string): ApiKeyConfig[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${at}: must be a list`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const r = Reader.of(entry, `${at}[${index}]`).allowOnly('name', 'sha256', 'scopes');
    const name = r.string('name');
    if (seen.has(name)) throw new Error(`${r.path('name')}: duplicate API key name "${name}"`);
    seen.add(name);
    const sha256 = r.string('sha256').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`${r.path('sha256')}: must be the 64-character hex SHA-256 of the key, not the key itself`);
    }
    const scopes = r.scopes('scopes');
    if (scopes.length === 0) throw new Error(`${r.path('scopes')}: an API key needs at least one scope`);
    return { name, sha256, scopes };
  });
};

const BCRYPT_HASH = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;
// The login form's own check, so every configured user can actually sign in.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const readLoginUsers = (value: unknown, at: string): LoginUserConfig[] => {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${at}: must be a non-empty list of users`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const r = Reader.of(entry, `${at}[${index}]`).allowOnly('email', 'name', 'passwordHash', 'scopes');
    // The login form lowercases what people type.
    const email = r.string('email').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error(`${r.path('email')}: "${email}" is not an email address`);
    if (seen.has(email)) throw new Error(`${r.path('email')}: duplicate user "${email}"`);
    seen.add(email);
    const passwordHash = r.string('passwordHash');
    const match = BCRYPT_HASH.exec(passwordHash);
    if (!match) {
      throw new Error(
        `${r.path('passwordHash')}: must be a bcrypt hash from \`contentia hash-password\`, not the password itself`,
      );
    }
    // A cheaper hash than the login page's decoy for unknown emails would let
    // response times reveal which emails exist.
    const cost = Number(match[1]);
    if (cost < PASSWORD_CONSTANTS.MIN_ROUNDS) {
      throw new Error(
        `${r.path('passwordHash')}: bcrypt cost ${cost} is below ${PASSWORD_CONSTANTS.MIN_ROUNDS}; `
          + 'rehash with `contentia hash-password`',
      );
    }
    const scopes = r.scopes('scopes');
    if (scopes.length === 0) throw new Error(`${r.path('scopes')}: a user needs at least one scope`);
    const name = r.optionalString('name');
    return { email, passwordHash, scopes, ...(name !== undefined && { name }) };
  });
};

const readLogin = (r: Reader): LoginConfig => {
  r.allowOnly('redirectUris', 'clientId', 'users');
  const redirectUris = r.stringList('redirectUris');
  for (const uri of redirectUris) {
    const protocol = URL.parse(uri)?.protocol;
    if (protocol !== 'https:' && protocol !== 'http:') {
      throw new Error(`${r.path('redirectUris')}: "${uri}" is not an http(s) URL`);
    }
  }
  return {
    redirectUris,
    clientId: r.string('clientId', DEFAULT_LOGIN_CLIENT_ID),
    users: readLoginUsers(r.obj.users, r.path('users')),
  };
};

const readAuth = (r: Reader): AuthConfig => {
  r.allowOnly('oidc', 'login', 'apiKeys');
  const auth: AuthConfig = {
    apiKeys: readApiKeys(r.obj.apiKeys, r.path('apiKeys')),
    ...(r.has('oidc') && { oidc: readOidc(r.child('oidc')) }),
    ...(r.has('login') && { login: readLogin(r.child('login')) }),
  };
  if (!auth.oidc && !auth.login && auth.apiKeys.length === 0) {
    throw new Error(
      `${r.at}: configure auth.oidc (your OAuth/OIDC provider), auth.login (users in this file, for testing) `
        + 'and/or auth.apiKeys',
    );
  }
  return auth;
};

export interface ServerConfigDefaults {
  /** `listen.host` when the config doesn't set one. Defaults to {@link DEFAULT_HOST}. */
  readonly host?: string;
}

/**
 * Validate an already-interpolated config tree. Throws an `Error` whose
 * message starts with the offending setting's path.
 */
export const parseServerConfig = (raw: unknown, defaults: ServerConfigDefaults = {}): ServerConfig => {
  const r = Reader.of(raw, '').allowOnly('listen', 'basePath', 'cors', 'storage', 'catalog', 'assets', 'auth');
  if (!r.has('storage')) {
    throw new Error('storage: required (e.g. storage: { backend: fs, options: { root: ./content } })');
  }
  if (!r.has('auth')) throw new Error('auth: required — configure auth.oidc, auth.login and/or auth.apiKeys');

  const listen = r.has('listen') ? r.child('listen').allowOnly('host', 'port') : new Reader({}, 'listen');
  const basePath = r.string('basePath', DEFAULT_BASE_PATH);
  if (!basePath.startsWith('/')) throw new Error('basePath: must start with "/"');

  return {
    listen: {
      host: listen.string('host', defaults.host ?? DEFAULT_HOST),
      port: listen.integer('port', DEFAULT_PORT, 0, 65_535),
    },
    basePath,
    storage: readStorage(r.child('storage')),
    catalog: readCatalog(r.obj.catalog, 'catalog'),
    assets: r.boolean('assets', true),
    auth: readAuth(r.child('auth')),
    ...(r.has('cors') && { cors: readCors(r.child('cors')) }),
  };
};

/**
 * Read, interpolate and validate a server config file (`.yaml`, `.yml` or
 * `.json`). Error messages are prefixed with the file path.
 *
 * `CONTENTIA_LISTEN_HOST` replaces the `127.0.0.1` default for `listen.host`;
 * the Docker image sets it to `0.0.0.0`, since a container that only listens
 * on its own loopback can't be reached.
 */
export const loadServerConfig = async (
  filePath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ServerConfig> => {
  const absolutePath = path.resolve(filePath);
  const prefix = (err: unknown) => new Error(`${absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
  let text: string;
  try {
    text = await fs.readFile(absolutePath, 'utf8');
  } catch (err) {
    throw prefix(err);
  }
  try {
    const ext = path.extname(absolutePath).toLowerCase();
    if (ext !== '.json' && ext !== '.yaml' && ext !== '.yml') {
      throw new Error('unsupported config extension (use .yaml, .yml or .json)');
    }
    const raw = ext === '.json' ? JSON.parse(text) : loadYaml(text);
    const host = env.CONTENTIA_LISTEN_HOST;
    return parseServerConfig(
      interpolateConfig(raw, { baseDir: path.dirname(absolutePath), env }),
      host ? { host } : {},
    );
  } catch (err) {
    throw prefix(err);
  }
};
