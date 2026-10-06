import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { lanAddresses, lanUrls, type Interfaces } from './lan.js';

const iface = (address: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4') =>
  ({
    address,
    family,
    internal,
    netmask: '',
    mac: '',
    cidr: null,
  }) as unknown as NetworkInterfaceInfo;
const nics: Interfaces = {
  lo: [iface('127.0.0.1', true)],
  eth0: [iface('192.168.1.20'), iface('fe80::1', false, 'IPv6'), iface('169.254.3.4')],
  wlan0: [iface('10.0.0.7')],
};

describe('LAN address selection', () => {
  it('keeps external IPv4 only', () => {
    expect(lanAddresses(nics)).toEqual(['192.168.1.20', '10.0.0.7']);
  });
  it('lists every LAN URL for a wildcard bind, none for loopback', () => {
    expect(lanUrls('0.0.0.0', 9, nics)).toEqual(['http://192.168.1.20:9', 'http://10.0.0.7:9']);
    expect(lanUrls('127.0.0.1', 9, nics)).toEqual([]);
    expect(lanUrls('10.0.0.7', 9, nics)).toEqual(['http://10.0.0.7:9']);
  });
});
