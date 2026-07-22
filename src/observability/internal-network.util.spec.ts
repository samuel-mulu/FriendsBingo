import { isInternalOrLocalIp } from './internal-network.util';

describe('isInternalOrLocalIp', () => {
  it('allows localhost and private IPv4 ranges', () => {
    expect(isInternalOrLocalIp('127.0.0.1')).toBe(true);
    expect(isInternalOrLocalIp('10.1.2.3')).toBe(true);
    expect(isInternalOrLocalIp('172.16.10.4')).toBe(true);
    expect(isInternalOrLocalIp('192.168.1.20')).toBe(true);
    expect(isInternalOrLocalIp('169.254.20.10')).toBe(true);
  });

  it('allows localhost and private IPv6 ranges', () => {
    expect(isInternalOrLocalIp('::1')).toBe(true);
    expect(isInternalOrLocalIp('fc00::1')).toBe(true);
    expect(isInternalOrLocalIp('fd12:3456:789a::1')).toBe(true);
    expect(isInternalOrLocalIp('fe80::1234')).toBe(true);
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(isInternalOrLocalIp('::ffff:127.0.0.1')).toBe(true);
    expect(isInternalOrLocalIp('::ffff:10.20.30.40')).toBe(true);
  });

  it('rejects public or malformed addresses', () => {
    expect(isInternalOrLocalIp('8.8.8.8')).toBe(false);
    expect(isInternalOrLocalIp('2607:f8b0:4004:815::200e')).toBe(false);
    expect(isInternalOrLocalIp('')).toBe(false);
    expect(isInternalOrLocalIp('not-an-ip')).toBe(false);
  });
});
