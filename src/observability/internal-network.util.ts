import { isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = '::ffff:';

function normalizeIp(ip: string | undefined | null): string {
  const trimmed = ip?.trim() ?? '';
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith(IPV4_MAPPED_PREFIX)) {
    return trimmed.slice(IPV4_MAPPED_PREFIX.length);
  }

  return trimmed;
}

function isPrivateIpv4(ip: string): boolean {
  const [first, second] = ip.split('.').map((part) => Number(part));
  if ([first, second].some((part) => Number.isNaN(part))) {
    return false;
  }

  return (
    first === 10 ||
    first === 127 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254)
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

export function isInternalOrLocalIp(ip: string | undefined | null): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) {
    return false;
  }

  const version = isIP(normalized);
  if (version === 4) {
    return isPrivateIpv4(normalized);
  }

  if (version === 6) {
    return isPrivateIpv6(normalized);
  }

  return false;
}
