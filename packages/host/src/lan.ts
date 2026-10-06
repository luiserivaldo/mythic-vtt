import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export type Interfaces = Record<string, NetworkInterfaceInfo[] | undefined>;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith('127.');
}

/** Private-network IPv4 addresses players can reach; link-local, loopback and IPv6 are skipped. */
export function lanAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const infos of Object.values(interfaces)) {
    for (const i of infos ?? []) {
      // `family` is a number on some Node versions and a string on others.
      const v4 = i.family === 'IPv4' || (i.family as unknown) === 4;
      if (v4 && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address);
    }
  }
  return [...new Set(out)];
}

/** URLs to show for the bound host: none for loopback, every LAN address for a wildcard bind. */
export function lanUrls(host: string, port: number, interfaces?: Interfaces): string[] {
  if (isLoopbackHost(host)) return [];
  const addrs = host === '0.0.0.0' || host === '::' ? lanAddresses(interfaces) : [host];
  return addrs.map((a) => `http://${a}:${String(port)}`);
}
