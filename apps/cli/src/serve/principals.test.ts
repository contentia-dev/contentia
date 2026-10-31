import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { OidcConfig } from './config.js';
import type { JwtClaims } from './oidc.js';
import { createApiKeyAuthenticator, readClaim, userFromClaims } from './principals.js';

const base: OidcConfig = { issuer: 'https://idp', audience: ['contentia'], roles: {}, defaultScopes: [] };
const token = (extra: Record<string, unknown> = {}): JwtClaims => ({ iss: 'https://idp', sub: 'u1', exp: 1, ...extra });

describe('readClaim', () => {
  it('prefers an exact (namespaced) claim name, then follows dot paths', () => {
    const claims = { 'https://acme.com/roles': ['a'], realm_access: { roles: ['b'] } };
    expect(readClaim(claims, 'https://acme.com/roles')).toEqual(['a']);
    expect(readClaim(claims, 'realm_access.roles')).toEqual(['b']);
    expect(readClaim(claims, 'realm_access.missing')).toBeUndefined();
    expect(readClaim(claims, 'realm_access.roles.length')).toBeUndefined();
  });

  it('never reads inherited properties', () => {
    expect(readClaim({}, 'constructor')).toBeUndefined();
    expect(readClaim({ a: {} }, 'a.toString')).toBeUndefined();
  });
});

describe('userFromClaims', () => {
  it('maps identity claims', () => {
    expect(userFromClaims(token({ email: 'e@x.com', name: 'Eve' }), base)).toEqual({
      id: 'u1',
      email: 'e@x.com',
      name: 'Eve',
      scopes: [],
    });
    expect(userFromClaims(token({ preferred_username: 'eve' }), base)).toEqual({
      id: 'u1',
      email: 'u1',
      name: 'eve',
      scopes: [],
    });
  });

  it('grants scopes through the role mapping', () => {
    const oidc: OidcConfig = {
      ...base,
      rolesClaim: 'realm_access.roles',
      roles: { editor: ['content:read', 'content:write'], viewer: ['content:read'] },
      defaultScopes: ['media:read'],
    };
    const user = userFromClaims(token({ realm_access: { roles: ['editor', 'viewer', 'offline_access'] } }), oidc);
    expect(user.scopes).toEqual(['media:read', 'content:read', 'content:write']);
  });

  it('accepts a space-separated roles string', () => {
    const oidc: OidcConfig = { ...base, rolesClaim: 'roles', roles: { admin: ['admin'] } };
    expect(userFromClaims(token({ roles: 'user admin' }), oidc).scopes).toEqual(['admin']);
  });

  it('ignores roles that only exist on Object.prototype', () => {
    const oidc: OidcConfig = { ...base, rolesClaim: 'roles', roles: { editor: ['content:write'] } };
    expect(userFromClaims(token({ roles: ['constructor', '__proto__', 'toString'] }), oidc).scopes).toEqual([]);
  });

  it('ignores the scope claim unless scopesClaim opts in', () => {
    const claims = token({ scope: 'openid profile content:write' });
    expect(userFromClaims(claims, base).scopes).toEqual([]);
    expect(userFromClaims(claims, { ...base, scopesClaim: 'scope' }).scopes).toEqual(['content:write']);
    expect(userFromClaims(token({ scp: ['content:read', 'User.Read'] }), { ...base, scopesClaim: 'scp' }).scopes)
      .toEqual(['content:read']);
  });
});

describe('createApiKeyAuthenticator', () => {
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
  const authenticate = createApiKeyAuthenticator([
    { name: 'build', sha256: sha256('read-key'), scopes: ['content:read'] },
    { name: 'importer', sha256: sha256('write-key'), scopes: ['content:write', 'admin'] },
  ]);

  it('returns the matching key as a principal', async () => {
    expect(await authenticate('read-key')).toEqual({
      id: 'api-key:build',
      email: 'build@api-key.invalid',
      name: 'build',
      scopes: ['content:read'],
    });
    expect((await authenticate('write-key')).scopes).toEqual(['admin']);
  });

  it('rejects unknown keys', async () => {
    await expect(authenticate('read-key ')).rejects.toThrow('Invalid API key');
    await expect(authenticate(sha256('read-key'))).rejects.toThrow('Invalid API key');
  });
});
