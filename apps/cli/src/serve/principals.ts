import { hashesEqual, hashToken, isScope, normalizeScopes, type Scope } from 'contentia/auth';
import { AuthenticationError } from 'contentia/core';

import type { User } from '@contentia/server/api';

import type { ApiKeyConfig, OidcConfig } from './config.js';
import type { JwtClaims } from './oidc.js';

/**
 * Look a claim up by exact name first (namespaced claims such as
 * `https://acme.com/roles` contain dots), then as a dot path
 * (`realm_access.roles` in Keycloak).
 */
export const readClaim = (claims: Readonly<Record<string, unknown>>, name: string): unknown => {
  if (Object.hasOwn(claims, name)) return claims[name];
  let current: unknown = claims;
  for (const segment of name.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

/** A claim value as a list of strings: arrays as-is, strings split on whitespace (the `scope` format). */
const claimValues = (value: unknown): string[] => {
  if (typeof value === 'string') return value.split(/\s+/).filter(v => v !== '');
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
};

/** Map a verified OIDC access token to the principal `contentiaApi` authorizes. */
export const userFromClaims = (claims: JwtClaims, oidc: OidcConfig): User => {
  const scopes: Scope[] = [...oidc.defaultScopes];
  if (oidc.rolesClaim !== undefined) {
    for (const role of claimValues(readClaim(claims, oidc.rolesClaim))) {
      // Own-property lookup: a role named `constructor` must not reach Object.prototype.
      if (Object.hasOwn(oidc.roles, role)) scopes.push(...oidc.roles[role]!);
    }
  }
  if (oidc.scopesClaim !== undefined) {
    scopes.push(...claimValues(readClaim(claims, oidc.scopesClaim)).filter(isScope));
  }
  const email = typeof claims.email === 'string' ? claims.email : claims.sub;
  const name = typeof claims.name === 'string'
    ? claims.name
    : typeof claims.preferred_username === 'string'
    ? claims.preferred_username
    : undefined;
  return { id: claims.sub, email, ...(name !== undefined && { name }), scopes: normalizeScopes(scopes) };
};

/**
 * `authenticateApiToken` over the configured keys. Only SHA-256 digests are
 * configured, so a leaked config file doesn't leak usable keys — as long as
 * the keys are random (e.g. `openssl rand -base64 32`), not guessable words.
 */
export const createApiKeyAuthenticator =
  (keys: readonly ApiKeyConfig[]) => async (presented: string): Promise<User> => {
    const digest = hashToken(presented);
    let match: ApiKeyConfig | undefined;
    // Compare against every key so timing doesn't reveal which one matched.
    for (const key of keys) {
      if (hashesEqual(digest, key.sha256)) match = key;
    }
    if (!match) throw new AuthenticationError('Invalid API key');
    return {
      id: `api-key:${match.name}`,
      // `.invalid` is reserved (RFC 2606): API keys have no mailbox.
      email: `${match.name}@api-key.invalid`,
      name: match.name,
      scopes: normalizeScopes([...match.scopes]),
    };
  };
