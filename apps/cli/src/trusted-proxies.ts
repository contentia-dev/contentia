import * as IpNetwork from 'effect/net/IpNetwork';
import * as NetAddress from 'effect/net/NetAddress';
import * as Result from 'effect/Result';

/**
 * Parse one trusted proxy: a CIDR range (`10.0.0.0/8`, `fd00::/8`) or a single
 * address (`10.0.0.7`, `::1`). Throws an `Error` naming the entry and the reason.
 *
 * Addresses are canonicalised the way the forwarded-headers middleware
 * canonicalises the connecting peer, so an IPv4-mapped IPv6 entry such as
 * `::ffff:10.0.0.7` still matches a proxy connecting over IPv4.
 */
export const parseTrustedProxy = (entry: string): IpNetwork.IpNetwork => {
  const value = entry.trim();
  if (value.includes('/')) {
    const network = IpNetwork.fromString(value);
    if (Result.isSuccess(network)) return network.success;
    throw new Error(`"${entry}" is not an IP address or CIDR range (${network.failure.message})`);
  }
  const address = NetAddress.ipFromString(value);
  if (Result.isFailure(address)) {
    throw new Error(`"${entry}" is not an IP address or CIDR range (${address.failure.message})`);
  }
  const canonical = NetAddress.toCanonical(address.success);
  return IpNetwork.fromAddressUnsafe(canonical, NetAddress.isIpv4Address(canonical) ? 32 : 128);
};

/** {@link parseTrustedProxy} for every entry. */
export const parseTrustedProxies = (entries: readonly string[]): IpNetwork.IpNetwork[] =>
  entries.map(parseTrustedProxy);
