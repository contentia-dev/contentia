import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createJwtVerifier, JwtVerificationError, type JwtVerifierOptions, SUPPORTED_ALGORITHMS } from './oidc.js';
import { base64Url, createTestIssuer, type TestIssuer } from './testing.js';

const NOW = 1_800_000_000_000;
const nowSeconds = NOW / 1000;

const claims = (issuer: string, extra: Record<string, unknown> = {}) => ({
  iss: issuer,
  sub: 'user-1',
  aud: 'contentia',
  exp: nowSeconds + 300,
  iat: nowSeconds,
  ...extra,
});

const verifierFor = (idp: TestIssuer, options: Partial<JwtVerifierOptions> = {}) =>
  createJwtVerifier({ issuer: idp.issuer, audience: ['contentia'], fetch: idp.fetch, now: () => NOW, ...options });

describe('createJwtVerifier', () => {
  it.each(SUPPORTED_ALGORITHMS)('accepts a valid %s token found through OIDC discovery', async alg => {
    const idp = await createTestIssuer(undefined, alg);
    const verify = verifierFor(idp);
    const result = await verify(await idp.sign(claims(idp.issuer)));
    expect(result.sub).toBe('user-1');
    expect(idp.requests).toEqual([
      `${idp.issuer}/.well-known/openid-configuration`,
      `${idp.issuer}/protocol/openid-connect/certs`,
    ]);
  });

  it('caches the JWKS between tokens', async () => {
    const idp = await createTestIssuer();
    const verify = verifierFor(idp);
    await verify(await idp.sign(claims(idp.issuer)));
    await verify(await idp.sign(claims(idp.issuer)));
    expect(idp.requests).toHaveLength(2);
  });

  it('uses a configured jwksUri without discovery', async () => {
    const idp = await createTestIssuer();
    const verify = verifierFor(idp, { jwksUri: `${idp.issuer}/protocol/openid-connect/certs` });
    await verify(await idp.sign(claims(idp.issuer)));
    expect(idp.requests).toEqual([`${idp.issuer}/protocol/openid-connect/certs`]);
  });

  it('accepts aud as an array containing a configured audience', async () => {
    const idp = await createTestIssuer();
    const verify = verifierFor(idp);
    await expect(verify(await idp.sign(claims(idp.issuer, { aud: ['account', 'contentia'] })))).resolves.toBeTruthy();
  });

  describe('rejects', () => {
    const rejects = async (token: Promise<string> | string, idp: TestIssuer, message: RegExp, options = {}) => {
      const error = await verifierFor(idp, options)(await token).catch(e => e);
      expect(error).toBeInstanceOf(JwtVerificationError);
      expect(error.message).toMatch(message);
    };

    it('alg "none"', async () => {
      const idp = await createTestIssuer();
      const token = `${base64Url(JSON.stringify({ alg: 'none' }))}.${base64Url(JSON.stringify(claims(idp.issuer)))}.`;
      await rejects(token, idp, /algorithm none is not accepted/);
    });

    it('HS256 signed with the public key (algorithm confusion)', async () => {
      const idp = await createTestIssuer();
      const input = `${base64Url(JSON.stringify({ alg: 'HS256', kid: idp.jwks.keys[0]!.kid }))}.${
        base64Url(JSON.stringify(claims(idp.issuer)))
      }`;
      const mac = createHmac('sha256', JSON.stringify(idp.jwks.keys[0])).update(input).digest('base64url');
      await rejects(`${input}.${mac}`, idp, /algorithm HS256 is not accepted/);
    });

    it('an algorithm outside the configured allowlist', async () => {
      const idp = await createTestIssuer(undefined, 'RS256');
      await rejects(idp.sign(claims(idp.issuer)), idp, /algorithm RS256 is not accepted/, { algorithms: ['ES256'] });
    });

    it('a header alg that does not match the key type', async () => {
      const idp = await createTestIssuer(undefined, 'RS256');
      await rejects(idp.sign(claims(idp.issuer), { header: { alg: 'ES256' } }), idp, /no matching signing key/);
    });

    it('a tampered payload', async () => {
      const idp = await createTestIssuer();
      const [h, , s] = (await idp.sign(claims(idp.issuer))).split('.');
      const forged = base64Url(JSON.stringify(claims(idp.issuer, { sub: 'admin' })));
      await rejects(`${h}.${forged}.${s}`, idp, /bad signature/);
    });

    it('a token signed by a key the issuer does not publish', async () => {
      const idp = await createTestIssuer();
      const kid = await idp.addKey('RS256', { publish: false });
      await rejects(idp.sign(claims(idp.issuer), { kid }), idp, /no matching signing key/);
    });

    it('another issuer', async () => {
      const idp = await createTestIssuer();
      await rejects(idp.sign(claims('https://evil.example.com')), idp, /wrong issuer/);
    });

    it('another audience', async () => {
      const idp = await createTestIssuer();
      await rejects(idp.sign(claims(idp.issuer, { aud: 'some-other-app' })), idp, /wrong audience/);
    });

    it('a missing audience', async () => {
      const idp = await createTestIssuer();
      await rejects(idp.sign(claims(idp.issuer, { aud: undefined })), idp, /wrong audience/);
    });

    it('an expired token (beyond clock tolerance)', async () => {
      const idp = await createTestIssuer();
      await rejects(idp.sign(claims(idp.issuer, { exp: nowSeconds - 61 })), idp, /expired/);
    });

    it('a token without exp', async () => {
      const idp = await createTestIssuer();
      await rejects(idp.sign(claims(idp.issuer, { exp: undefined })), idp, /no expiry/);
    });

    it('a token that is not valid yet', async () => {
      const idp = await createTestIssuer();
      await rejects(idp.sign(claims(idp.issuer, { nbf: nowSeconds + 120 })), idp, /not valid yet/);
    });

    it('a token without a subject', async () => {
      const idp = await createTestIssuer();
      await rejects(idp.sign(claims(idp.issuer, { sub: '' })), idp, /no subject/);
    });

    it('critical header extensions', async () => {
      const idp = await createTestIssuer();
      await rejects(idp.sign(claims(idp.issuer), { header: { crit: ['b64'] } }), idp, /critical header/);
    });

    it('RSA keys shorter than 2048 bits', async () => {
      const idp = await createTestIssuer();
      const kid = await idp.addKey('RS256', { modulusLength: 1024 });
      await rejects(idp.sign(claims(idp.issuer), { kid }), idp, /shorter than 2048 bits/);
    });

    it('a token without kid when the JWKS has several candidate keys', async () => {
      const idp = await createTestIssuer();
      await idp.addKey('RS256');
      await rejects(idp.sign(claims(idp.issuer), { header: { kid: undefined } }), idp, /no matching signing key/);
    });

    it('garbage', async () => {
      const idp = await createTestIssuer();
      await rejects('not-a-jwt', idp, /not a JWS/);
      await rejects('a.b.c', idp, /header is not JSON/);
      await rejects('a!.b.c', idp, /malformed base64url/);
    });
  });

  it('accepts a token without kid when exactly one key fits', async () => {
    const idp = await createTestIssuer();
    const verify = verifierFor(idp);
    await expect(verify(await idp.sign(claims(idp.issuer), { header: { kid: undefined } }))).resolves.toBeTruthy();
  });

  it('refetches the JWKS once when a token names an unknown kid (key rotation)', async () => {
    const idp = await createTestIssuer();
    const verify = verifierFor(idp);
    await verify(await idp.sign(claims(idp.issuer)));
    const rotated = await idp.addKey('ES256');
    await expect(verify(await idp.sign(claims(idp.issuer), { kid: rotated }))).resolves.toBeTruthy();
    expect(idp.requests.filter(u => u.endsWith('/certs'))).toHaveLength(2);
  });

  it('limits refetches for unknown kids so tokens cannot hammer the provider', async () => {
    const idp = await createTestIssuer();
    const verify = verifierFor(idp);
    const unknown = await idp.addKey('RS256', { publish: false });
    for (let i = 0; i < 5; i++) await verify(await idp.sign(claims(idp.issuer), { kid: unknown })).catch(() => {});
    // initial fetch + one forced refetch inside the cooldown window
    expect(idp.requests.filter(u => u.endsWith('/certs'))).toHaveLength(2);
  });

  it('keeps using the last good JWKS when the provider is down', async () => {
    const idp = await createTestIssuer();
    let t = NOW;
    let down = false;
    const verify = createJwtVerifier({
      issuer: idp.issuer,
      audience: ['contentia'],
      now: () => t,
      fetch: async (input, init) => down ? new Response('', { status: 503 }) : idp.fetch(input, init),
    });
    await verify(await idp.sign(claims(idp.issuer)));
    down = true;
    t += 3_600_000;
    await expect(verify(await idp.sign(claims(idp.issuer, { exp: t / 1000 + 300 })))).resolves.toBeTruthy();
  });

  it('refuses a discovery document for a different issuer', async () => {
    const idp = await createTestIssuer();
    const verify = createJwtVerifier({
      issuer: idp.issuer,
      audience: ['contentia'],
      now: () => NOW,
      fetch: async () =>
        new Response(JSON.stringify({ issuer: 'https://evil.example.com', jwks_uri: 'https://x/certs' })),
    });
    await expect(verify(await idp.sign(claims(idp.issuer)))).rejects.toThrow(/is for issuer https:\/\/evil/);
  });

  it('refuses a plain-http jwks_uri from discovery', async () => {
    const idp = await createTestIssuer();
    const verify = createJwtVerifier({
      issuer: idp.issuer,
      audience: ['contentia'],
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ issuer: idp.issuer, jwks_uri: 'http://idp.internal/certs' })),
    });
    await expect(verify(await idp.sign(claims(idp.issuer)))).rejects.toThrow(/no usable https jwks_uri/);
  });
});
