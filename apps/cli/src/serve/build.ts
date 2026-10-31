import { CatalogAssetsRepository } from 'contentia/assets-catalog';
import type { CatalogProvider } from 'contentia/catalog';
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { DecapCatalogProvider } from 'contentia/catalog-decap';
import { AuthenticationError } from 'contentia/core';
import { CatalogDocumentsRepository } from 'contentia/documents-catalog';
import { InProcessLockManager } from 'contentia/locks/in-process';

import { type ContentiaApi, contentiaApi, createScopePolicy } from 'contentia/server/api';

import { buildStorageRepository } from '../drivers/registry.js';
import type { ServerConfig } from './config.js';
import { createServerLogger, type ServerLogger } from './logger.js';
import { createLoginServer } from './login.js';
import { createJwtVerifier } from './oidc.js';
import { createApiKeyAuthenticator, userFromClaims } from './principals.js';

export interface BuildServerApiOptions {
  /** Defaults to {@link createServerLogger} over the console. */
  readonly logger?: ServerLogger;
  /** Used for OIDC discovery and JWKS requests. */
  readonly fetch?: typeof fetch;
}

/**
 * Assemble the HTTP API a {@link ServerConfig} describes: the configured
 * storage backend, documents and assets over its catalog, and authentication
 * that ends in the shared scope policy (`content:*`, `media:*`, `admin`).
 *
 * Backends must already be installed — a server never runs `npm install`
 * at startup.
 */
export const buildServerApi = async (
  config: ServerConfig,
  options: BuildServerApiOptions = {},
): Promise<ContentiaApi> => {
  const storage = await buildStorageRepository(config.storage.backend, config.storage.options, { noInstall: true });
  const catalog: CatalogProvider = config.catalog.provider === 'decap'
    ? new DecapCatalogProvider({ storage, configKey: config.catalog.configKey })
    : new ConventionCatalogProvider({ storage });

  const logger = options.logger ?? createServerLogger();
  const { oidc, login: loginConfig, apiKeys } = config.auth;
  const login = loginConfig ? createLoginServer(loginConfig, logger) : undefined;
  await login?.ready();
  const verifyJwt = oidc
    ? createJwtVerifier({
      issuer: oidc.issuer,
      audience: oidc.audience,
      ...(oidc.jwksUri !== undefined && { jwksUri: oidc.jwksUri }),
      ...(oidc.algorithms !== undefined && { algorithms: oidc.algorithms }),
      ...(oidc.clockToleranceSeconds !== undefined && { clockToleranceSeconds: oidc.clockToleranceSeconds }),
      ...(options.fetch !== undefined && { fetch: options.fetch }),
    })
    : undefined;

  const api = contentiaApi({
    storage,
    documents: new CatalogDocumentsRepository(storage, catalog),
    ...(config.assets && { assets: new CatalogAssetsRepository(storage, catalog) }),
    basePath: config.basePath,
    async authenticateAccessToken(token) {
      const user = login?.userForAccessToken(token);
      if (user) return user;
      if (verifyJwt && oidc) return userFromClaims(await verifyJwt(token), oidc);
      throw new AuthenticationError(
        login
          ? 'Invalid or expired access token'
          : 'Bearer tokens are not accepted: configure auth.oidc or auth.login',
      );
    },
    ...(apiKeys.length > 0 && { authenticateApiToken: createApiKeyAuthenticator(apiKeys) }),
    authorize: createScopePolicy(),
    // Advisory "being edited by…" locks live in this process, so they are
    // only shared between editors that reach the same replica.
    locks: new InProcessLockManager(),
    logger,
    ...(config.cors && { cors: config.cors }),
  });
  if (!login) return api;
  return {
    ...api,
    fetch: request => login.handles(new URL(request.url).pathname) ? login.fetch(request) : api.fetch(request),
  };
};

/** Config choices worth a warning at startup. Never includes secrets. */
export const serverConfigWarnings = (config: ServerConfig): string[] => {
  const warnings: string[] = [];
  const origins = config.cors?.origins;
  if (origins === '*') warnings.push('cors.origins is "*" — any website can call this API');
  const { login } = config.auth;
  if (login) {
    warnings.push(
      'auth.login is for testing: sessions live in memory, so a restart signs everyone out and a login only '
        + 'works on the replica that issued it. Use auth.oidc with your own provider in production.',
    );
    if (origins !== '*') {
      const missing = new Set(
        login.redirectUris.map(uri => new URL(uri).origin).filter(origin => !origins?.includes(origin)),
      );
      for (const origin of missing) {
        warnings.push(
          `auth.login.redirectUris: ${origin} is not in cors.origins, so an admin there can sign in `
            + 'but not call the API',
        );
      }
    }
  }
  return warnings;
};

/** One line saying what a config serves, for startup logs. Never includes secrets. */
export const describeServerConfig = (config: ServerConfig): string => {
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const auth = [
    ...(config.auth.oidc ? [`OIDC (${config.auth.oidc.issuer})`] : []),
    ...(config.auth.login ? [`login (${plural(config.auth.login.users.length, 'user')})`] : []),
    ...(config.auth.apiKeys.length > 0 ? [plural(config.auth.apiKeys.length, 'API key')] : []),
  ];
  return `${config.storage.backend} storage, ${config.catalog.provider} catalog, auth: ${auth.join(' + ')}`;
};
