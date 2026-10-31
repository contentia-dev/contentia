/**
 * Verifies access tokens issued by an external OAuth 2.0 / OpenID Connect
 * provider (Keycloak, Entra ID, Auth0, Okta, Zitadel, Dex, …) against its
 * published JWKS. Built on Web Crypto + fetch only, so it carries no
 * dependency and no Node-specific API.
 *
 * Deliberately strict:
 * - only asymmetric algorithms; `none` and HMAC are never accepted, so a
 *   public key can't be abused as an HMAC secret (algorithm confusion);
 * - the key must match the token's `alg` by type and curve, and its own `alg`
 *   when the JWKS states one;
 * - `iss` must equal the configured issuer exactly, and `aud` must contain a
 *   configured audience, so tokens minted for other apps at the same provider
 *   are rejected;
 * - `exp` is required; RSA keys under 2048 bits are refused.
 */

export const SUPPORTED_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
] as const;

export type JwtAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

export const isJwtAlgorithm = (value: string): value is JwtAlgorithm =>
  (SUPPORTED_ALGORITHMS as readonly string[]).includes(value);

interface AlgorithmSpec {
  readonly kty: 'RSA' | 'EC' | 'OKP';
  readonly crv?: string;
  readonly importParams: RsaHashedImportParams | EcKeyImportParams | Algorithm;
  readonly verifyParams: Algorithm | RsaPssParams | EcdsaParams;
}

const rsa = (name: 'RSASSA-PKCS1-v1_5' | 'RSA-PSS', bits: 256 | 384 | 512): AlgorithmSpec => ({
  kty: 'RSA',
  importParams: { name, hash: `SHA-${bits}` },
  verifyParams: name === 'RSA-PSS' ? { name, saltLength: bits / 8 } : { name },
});

const ecdsa = (crv: 'P-256' | 'P-384' | 'P-521', bits: 256 | 384 | 512): AlgorithmSpec => ({
  kty: 'EC',
  crv,
  importParams: { name: 'ECDSA', namedCurve: crv },
  verifyParams: { name: 'ECDSA', hash: `SHA-${bits}` },
});

const ALGORITHMS: Record<JwtAlgorithm, AlgorithmSpec> = {
  RS256: rsa('RSASSA-PKCS1-v1_5', 256),
  RS384: rsa('RSASSA-PKCS1-v1_5', 384),
  RS512: rsa('RSASSA-PKCS1-v1_5', 512),
  PS256: rsa('RSA-PSS', 256),
  PS384: rsa('RSA-PSS', 384),
  PS512: rsa('RSA-PSS', 512),
  ES256: ecdsa('P-256', 256),
  ES384: ecdsa('P-384', 384),
  ES512: ecdsa('P-521', 512),
  EdDSA: { kty: 'OKP', crv: 'Ed25519', importParams: { name: 'Ed25519' }, verifyParams: { name: 'Ed25519' } },
};

const MIN_RSA_MODULUS_BITS = 2048;
/** How long a fetched JWKS is trusted before it is refetched. */
const DEFAULT_JWKS_CACHE_SECONDS = 600;
/** An unknown `kid` refetches the JWKS (key rotation), at most this often. */
const UNKNOWN_KID_REFETCH_COOLDOWN_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface Jwk {
  readonly kty: string;
  readonly kid?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly key_ops?: readonly string[];
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
}

export interface JwtClaims {
  readonly iss: string;
  readonly sub: string;
  readonly exp: number;
  readonly [claim: string]: unknown;
}

export interface JwtVerifierOptions {
  /** Expected `iss`, compared exactly (mind trailing slashes, e.g. Auth0's). */
  readonly issuer: string;
  /** The token's `aud` must contain at least one of these. */
  readonly audience: readonly string[];
  /** JWKS location. Defaults to `jwks_uri` from the issuer's OIDC discovery document. */
  readonly jwksUri?: string;
  /** Accepted `alg` values. Defaults to every {@link SUPPORTED_ALGORITHMS} entry. */
  readonly algorithms?: readonly JwtAlgorithm[];
  /** Allowed clock skew for `exp` / `nbf`, in seconds. Default 60. */
  readonly clockToleranceSeconds?: number;
  readonly jwksCacheSeconds?: number;
  readonly fetch?: typeof fetch;
  /** Current time in milliseconds. */
  readonly now?: () => number;
}

export class JwtVerificationError extends Error {
  override readonly name = 'JwtVerificationError';
  /** Always the client's problem: answered with 401, logged without a stack. */
  readonly status = 401;
}

// A declaration (not an arrow) so `if (…) fail(…)` narrows like a throw.
function fail(reason: string): never {
  throw new JwtVerificationError(`Invalid access token: ${reason}`);
}

const decodeBase64Url = (segment: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) fail('malformed base64url');
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const decodeJsonSegment = (segment: string, what: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
  } catch (err) {
    if (err instanceof JwtVerificationError) throw err;
    return fail(`${what} is not JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${what} is not a JSON object`);
  return parsed as Record<string, unknown>;
};

/** `https:`, or plain `http:` to a loopback host (local providers in development). */
export const isHttpsOrLoopback = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:'
      || (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname));
  } catch {
    return false;
  }
};

/**
 * Build a verifier for one issuer. The returned function resolves to the
 * token's claims, or rejects with a {@link JwtVerificationError}.
 */
export const createJwtVerifier = (options: JwtVerifierOptions): (token: string) => Promise<JwtClaims> => {
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const allowed = new Set<JwtAlgorithm>(options.algorithms ?? SUPPORTED_ALGORITHMS);
  const toleranceSeconds = options.clockToleranceSeconds ?? 60;
  const cacheMs = (options.jwksCacheSeconds ?? DEFAULT_JWKS_CACHE_SECONDS) * 1000;

  const getJson = async (url: string, what: string): Promise<Record<string, unknown>> => {
    const response = await doFetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OIDC: fetching ${what} from ${url} failed with HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') throw new Error(`OIDC: ${what} at ${url} is not a JSON object`);
    return body as Record<string, unknown>;
  };

  let jwksUri: string | undefined = options.jwksUri;
  const resolveJwksUri = async (): Promise<string> => {
    if (jwksUri) return jwksUri;
    const discoveryUrl = `${options.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const discovery = await getJson(discoveryUrl, 'the discovery document');
    // OIDC Discovery §4.3: the document must name the issuer it was fetched for.
    if (discovery.issuer !== options.issuer) {
      throw new Error(
        `OIDC: discovery document at ${discoveryUrl} is for issuer ${String(discovery.issuer)}, not ${options.issuer}`,
      );
    }
    const uri = discovery.jwks_uri;
    if (typeof uri !== 'string' || !isHttpsOrLoopback(uri)) {
      throw new Error(`OIDC: discovery document at ${discoveryUrl} has no usable https jwks_uri`);
    }
    jwksUri = uri;
    return uri;
  };

  let keys: readonly Jwk[] | undefined;
  let fetchedAt = 0;
  let lastForcedRefetch = Number.NEGATIVE_INFINITY;
  let inflight: Promise<readonly Jwk[]> | undefined;

  const fetchKeys = async (): Promise<readonly Jwk[]> => {
    const jwks = await getJson(await resolveJwksUri(), 'the JWKS');
    if (!Array.isArray(jwks.keys)) throw new Error('OIDC: JWKS has no "keys" array');
    return jwks.keys.filter((k): k is Jwk => !!k && typeof k === 'object' && typeof k.kty === 'string');
  };

  const loadKeys = (force: boolean): Promise<readonly Jwk[]> => {
    const t = now();
    if (!force && keys && t - fetchedAt < cacheMs) return Promise.resolve(keys);
    if (force) {
      if (t - lastForcedRefetch < UNKNOWN_KID_REFETCH_COOLDOWN_MS) return Promise.resolve(keys ?? []);
      lastForcedRefetch = t;
    }
    inflight ??= fetchKeys()
      .then(fresh => {
        keys = fresh;
        fetchedAt = now();
        return fresh;
      }, err => {
        // A provider outage shouldn't log everyone out: keep the last good
        // keys until the provider is back.
        if (keys) return keys;
        throw err;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };

  const imported = new WeakMap<Jwk, CryptoKey>();
  const importKey = async (jwk: Jwk, alg: JwtAlgorithm): Promise<CryptoKey> => {
    const cached = imported.get(jwk);
    if (cached) return cached;
    const spec = ALGORITHMS[alg];
    // Import only the public members; `alg` / `key_ops` / `use` were already
    // checked by `selectKey` and would otherwise make importKey reject
    // otherwise-valid keys with spelling differences.
    const material: JsonWebKey = spec.kty === 'RSA'
      ? { kty: jwk.kty, n: jwk.n, e: jwk.e }
      : spec.kty === 'EC'
      ? { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
      : { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
    const key = await crypto.subtle.importKey('jwk', material, spec.importParams, false, ['verify']);
    if (spec.kty === 'RSA' && (key.algorithm as RsaHashedKeyAlgorithm).modulusLength < MIN_RSA_MODULUS_BITS) {
      fail(`RSA signing key is shorter than ${MIN_RSA_MODULUS_BITS} bits`);
    }
    imported.set(jwk, key);
    return key;
  };

  const selectKey = (candidates: readonly Jwk[], alg: JwtAlgorithm, kid: string | undefined): Jwk | undefined => {
    const spec = ALGORITHMS[alg];
    const usable = candidates.filter(k =>
      k.kty === spec.kty
      && (spec.crv === undefined || k.crv === spec.crv)
      && (k.use === undefined || k.use === 'sig')
      && (k.alg === undefined || k.alg === alg)
      && (k.key_ops === undefined || k.key_ops.includes('verify'))
      && (kid === undefined || k.kid === kid)
    );
    // Without a `kid` the choice must be unambiguous.
    return usable.length === 1 ? usable[0] : undefined;
  };

  return async (token: string): Promise<JwtClaims> => {
    const parts = token.split('.');
    if (parts.length !== 3) fail('not a JWS compact serialization');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

    const header = decodeJsonSegment(encodedHeader, 'header');
    const alg = header.alg;
    if (typeof alg !== 'string' || !isJwtAlgorithm(alg) || !allowed.has(alg)) {
      fail(`algorithm ${String(alg)} is not accepted`);
    }
    if (header.crit !== undefined) fail('critical header parameters are not supported');
    const kid = typeof header.kid === 'string' ? header.kid : undefined;

    let jwk = selectKey(await loadKeys(false), alg, kid);
    if (!jwk && kid !== undefined) jwk = selectKey(await loadKeys(true), alg, kid);
    if (!jwk) return fail('no matching signing key in the JWKS');

    const signature = decodeBase64Url(encodedSignature);
    const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const key = await importKey(jwk, alg);
    const valid = await crypto.subtle.verify(ALGORITHMS[alg].verifyParams, key, signature, signingInput);
    if (!valid) fail('bad signature');

    const claims = decodeJsonSegment(encodedPayload, 'payload');
    if (claims.iss !== options.issuer) fail('wrong issuer');

    const aud = claims.aud;
    const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];
    if (!audiences.some(a => typeof a === 'string' && options.audience.includes(a))) fail('wrong audience');

    const nowSeconds = now() / 1000;
    if (typeof claims.exp !== 'number') fail('no expiry');
    if (nowSeconds > claims.exp + toleranceSeconds) fail('expired');
    if (claims.nbf !== undefined) {
      if (typeof claims.nbf !== 'number') fail('malformed nbf');
      if (nowSeconds + toleranceSeconds < claims.nbf) fail('not valid yet');
    }
    if (typeof claims.sub !== 'string' || claims.sub === '') fail('no subject');

    return claims as JwtClaims;
  };
};
