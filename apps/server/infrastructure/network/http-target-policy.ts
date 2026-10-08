import { isIP } from 'node:net';
import type { LookupFunction, Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent, buildConnector, type Dispatcher } from 'undici';

export type TargetPolicyReason = 'scheme' | 'address' | 'dns' | 'redirect' | 'proxy';

export interface PublicLookupOptions {
  all?: boolean;
  family?: 0 | 4 | 6;
}

export type PublicLookup = (
  hostname: string,
  options: PublicLookupOptions,
) => Promise<LookupAddress[]>;

export interface CheckedAddress {
  address: string;
  family: 4 | 6;
}

/** Normalizes URL hostnames before IP classification and DNS lookup. */
export function normalizeTargetHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/** Error raised when a request target cannot be proven to be public. */
export class HttpTargetBlockedError extends Error {
  readonly code = 'HTTP_TARGET_BLOCKED';
  readonly reason: TargetPolicyReason;
  readonly hostname: string;
  readonly address?: string;

  constructor(hostname: string, reason: TargetPolicyReason, address?: string) {
    const safeAddress = address ? ` address=${address}` : '';
    super(`HTTP_TARGET_BLOCKED hostname=${hostname} reason=${reason}${safeAddress}`);
    this.name = 'HttpTargetBlockedError';
    this.reason = reason;
    this.hostname = hostname;
    this.address = address;
  }
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0) >>> 0;
}

function inIpv4Range(address: string, network: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask);
}

function parseIpv6(address: string): bigint | null {
  const withoutZone = address.split('%')[0];
  const halves = withoutZone.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const expanded = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (expanded < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array.from({ length: expanded }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Range(value: bigint, network: string, bits: number): boolean {
  const networkValue = parseIpv6(network);
  if (networkValue === null) return false;
  const shift = 128 - bits;
  return value >> BigInt(shift) === networkValue >> BigInt(shift);
}

function mappedIpv4(value: bigint): string | null {
  if (value >> 32n !== 0xffffn) return null;
  const number = Number(value & 0xffffffffn);
  return [24, 16, 8, 0].map((shift) => (number >>> shift) & 0xff).join('.');
}

/** Returns true for addresses that must not be contacted by public-only HTTP. */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return (
      [
        ['0.0.0.0', 8],
        ['10.0.0.0', 8],
        ['100.64.0.0', 10],
        ['127.0.0.0', 8],
        ['169.254.0.0', 16],
        ['172.16.0.0', 12],
        ['192.0.0.0', 24],
        ['192.0.2.0', 24],
        ['192.88.99.0', 24],
        ['192.168.0.0', 16],
        ['198.18.0.0', 15],
        ['198.51.100.0', 24],
        ['203.0.113.0', 24],
        ['224.0.0.0', 4],
        ['240.0.0.0', 4],
      ] as Array<[string, number]>
    ).some(([network, bits]) => inIpv4Range(address, network, bits));
  }
  if (family !== 6) return true;
  const value = parseIpv6(address);
  if (value === null) return true;
  const mapped = mappedIpv4(value);
  if (mapped) return isForbiddenAddress(mapped);
  return (
    [
      ['::', 128],
      ['::1', 128],
      ['fc00::', 7],
      ['fe80::', 10],
      ['fec0::', 10],
      ['ff00::', 8],
      ['2001:db8::', 32],
      ['2001:2::', 48],
    ] as Array<[string, number]>
  ).some(([network, bits]) => inIpv6Range(value, network, bits));
}

/** Fails closed when any DNS answer is invalid or private. */
export function assertAllowedAddresses(
  hostname: string,
  addresses: LookupAddress[],
): CheckedAddress[] {
  if (addresses.length === 0) throw new HttpTargetBlockedError(hostname, 'dns');
  const checked = addresses.map((address) => {
    if ((address.family !== 4 && address.family !== 6) || isForbiddenAddress(address.address)) {
      throw new HttpTargetBlockedError(hostname, 'address', address.address);
    }
    const family: 4 | 6 = address.family === 4 ? 4 : 6;
    return { address: address.address, family };
  });
  return checked;
}

/** Resolves all DNS answers for a hostname using the system resolver. */
export function defaultPublicLookup(
  hostname: string,
  _options: PublicLookupOptions,
): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        reject(new HttpTargetBlockedError(hostname, 'dns'));
        return;
      }
      resolve(addresses);
    });
  });
}

/** Resolves and validates a hostname or literal address for public-only HTTP. */
export async function resolvePublicAddresses(
  hostname: string,
  lookup = defaultPublicLookup,
): Promise<CheckedAddress[]> {
  const normalizedHostname = normalizeTargetHostname(hostname);
  const family = isIP(normalizedHostname);
  if (family !== 0) {
    if (isForbiddenAddress(normalizedHostname))
      throw new HttpTargetBlockedError(normalizedHostname, 'address', normalizedHostname);
    const resolvedFamily = family === 4 ? 4 : 6;
    return [{ address: normalizedHostname, family: resolvedFamily }];
  }
  try {
    return assertAllowedAddresses(
      normalizedHostname,
      await lookup(normalizedHostname, { all: true }),
    );
  } catch (error) {
    if (error instanceof HttpTargetBlockedError) throw error;
    throw new HttpTargetBlockedError(normalizedHostname, 'dns');
  }
}

interface ConnectorOptions {
  hostname: string;
  host?: string;
  protocol: string;
  port: string;
  servername?: string;
  localAddress?: string | null;
  socketPath?: string | null;
}

type ConnectorCallback = (...args: [null, Socket | TLSSocket] | [Error, null]) => void;

function createConnector(lookup: PublicLookup) {
  return (options: ConnectorOptions, callback: ConnectorCallback) => {
    const checkedLookup: LookupFunction = (hostname, lookupOptions, lookupCallback) => {
      resolvePublicAddresses(hostname, lookup)
        .then(([checked]) =>
          lookupOptions.all
            ? lookupCallback(null, [{ address: checked.address, family: checked.family }])
            : lookupCallback(null, checked.address, checked.family),
        )
        .catch((error) =>
          lookupCallback(error instanceof Error ? error : new Error(String(error)), '', 0),
        );
    };
    const connector = buildConnector({
      port: Number(options.port),
      servername: options.servername ?? options.hostname,
      lookup: checkedLookup,
    });
    connector({ ...options, host: options.hostname }, callback);
  };
}

/** Creates a direct dispatcher whose connector pins every socket to checked DNS output. */
export function createPublicDispatcher(lookup: PublicLookup = defaultPublicLookup): Dispatcher {
  return new Agent({ connect: createConnector(lookup), pipelining: 0 });
}
