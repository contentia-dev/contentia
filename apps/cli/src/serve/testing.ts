import type { Jwk, JwtAlgorithm } from './oidc.js';

/**
 * A fake OpenID provider for tests: real WebCrypto keys, a discovery document
 * and a JWKS served through a `fetch` stub, and a `sign` that mints tokens.
 */
export interface TestIssuer {
  readonly issuer: string;
  readonly fetch: typeof fetch;
  /** Every URL the verifier fetched, in order. */
  readonly requests: string[];
  /** The served JWKS; mutate to simulate rotation. */
  readonly jwks: { keys: Jwk[] };
  sign(claims: Record<string, unknown>, options?: SignOptions): Promise<string>;
  /** Add a signing key and return its `kid`. */
  addKey(alg: JwtAlgorithm, options?: { kid?: string, publish?: boolean, modulusLength?: number }): Promise<string>;
}

export interface SignOptions {
  readonly kid?: string;
  /** Override header fields (e.g. `alg: 'none'`). */
  readonly header?: Record<string, unknown>;
}

const rsaKey = (name: 'RSASSA-PKCS1-v1_5' | 'RSA-PSS', hash: string) => (modulusLength: number) => ({
  name,
  modulusLength,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash,
});

const GENERATE: Record<JwtAlgorithm, (modulusLength: number) => RsaHashedKeyGenParams | EcKeyGenParams | Algorithm> = {
  RS256: rsaKey('RSASSA-PKCS1-v1_5', 'SHA-256'),
  RS384: rsaKey('RSASSA-PKCS1-v1_5', 'SHA-384'),
  RS512: rsaKey('RSASSA-PKCS1-v1_5', 'SHA-512'),
  PS256: rsaKey('RSA-PSS', 'SHA-256'),
  PS384: rsaKey('RSA-PSS', 'SHA-384'),
  PS512: rsaKey('RSA-PSS', 'SHA-512'),
  ES256: () => ({ name: 'ECDSA', namedCurve: 'P-256' }),
  ES384: () => ({ name: 'ECDSA', namedCurve: 'P-384' }),
  ES512: () => ({ name: 'ECDSA', namedCurve: 'P-521' }),
  EdDSA: () => ({ name: 'Ed25519' }),
};

const signParams = (alg: JwtAlgorithm): Algorithm | RsaPssParams | EcdsaParams => {
  const bits = Number(alg.slice(2));
  if (alg.startsWith('RS')) return { name: 'RSASSA-PKCS1-v1_5' };
  if (alg.startsWith('PS')) return { name: 'RSA-PSS', saltLength: bits / 8 };
  if (alg.startsWith('ES')) return { name: 'ECDSA', hash: `SHA-${bits}` };
  return { name: 'Ed25519' };
};

export const base64Url = (data: string | Uint8Array | ArrayBuffer): string =>
  Buffer.from(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)).toString('base64url');

export const createTestIssuer = async (
  issuer = 'https://login.example.com/realms/acme',
  defaultAlg: JwtAlgorithm = 'RS256',
): Promise<TestIssuer> => {
  const requests: string[] = [];
  const jwks: { keys: Jwk[] } = { keys: [] };
  const privateKeys = new Map<string, { alg: JwtAlgorithm, key: CryptoKey }>();
  let counter = 0;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const fetchStub: typeof fetch = async input => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (url === `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`) {
      return json({ issuer, jwks_uri: `${issuer}/protocol/openid-connect/certs` });
    }
    if (url === `${issuer}/protocol/openid-connect/certs`) return json(jwks);
    return new Response('not found', { status: 404 });
  };

  const addKey: TestIssuer['addKey'] = async (alg, options = {}) => {
    const kid = options.kid ?? `key-${++counter}`;
    const pair = await crypto.subtle.generateKey(GENERATE[alg](options.modulusLength ?? 2048), true, [
      'sign',
      'verify',
    ]) as CryptoKeyPair;
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    privateKeys.set(kid, { alg, key: pair.privateKey });
    if (options.publish ?? true) jwks.keys.push({ ...publicJwk, kid, use: 'sig', alg } as Jwk);
    return kid;
  };

  const firstKid = await addKey(defaultAlg);

  return {
    issuer,
    fetch: fetchStub,
    requests,
    jwks,
    addKey,
    async sign(claims, options = {}) {
      const kid = options.kid ?? firstKid;
      const signer = privateKeys.get(kid);
      if (!signer) throw new Error(`no private key for ${kid}`);
      const header = { alg: signer.alg, typ: 'JWT', kid, ...options.header };
      const input = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
      const signature = await crypto.subtle.sign(signParams(signer.alg), signer.key, new TextEncoder().encode(input));
      return `${input}.${base64Url(signature)}`;
    },
  };
};
