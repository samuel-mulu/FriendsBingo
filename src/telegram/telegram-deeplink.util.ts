/**
 * Maps app push routes (shared with the mobile app) to Telegram Mini App paths.
 * The Mini App uses `/play` for games, `/wallet/*` for wallet screens and
 * `/support` for support; unknown routes fall back to the game lobby.
 */
const MINIAPP_FALLBACK_PATH = '/play';

const DIRECT_PATHS: Record<string, string> = {
  '/wallet': '/wallet',
  '/wallet/deposit': '/wallet/deposits',
  '/wallet/deposits': '/wallet/deposits',
  '/wallet/withdraw': '/wallet/withdrawals',
  '/wallet/withdrawals': '/wallet/withdrawals',
  '/wallet/transactions': '/wallet/transactions',
  '/games': '/play',
  '/games/big-game': '/play/big-game',
  '/support': '/support',
  '/notifications': '/notifications',
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function mapPushRouteToMiniappPath(route?: string | null): string {
  const trimmed = route?.trim();
  if (!trimmed) return MINIAPP_FALLBACK_PATH;

  let pathname: string;
  let sessionId: string | null;
  try {
    const parsed = new URL(trimmed, 'https://app.local');
    pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    sessionId = parsed.searchParams.get('sessionId');
  } catch {
    return MINIAPP_FALLBACK_PATH;
  }

  if (
    pathname.startsWith('/games') &&
    sessionId &&
    SESSION_ID_PATTERN.test(sessionId)
  ) {
    return `/play/${sessionId}`;
  }
  if (pathname.startsWith('/games/live')) return '/play';

  return DIRECT_PATHS[pathname] ?? MINIAPP_FALLBACK_PATH;
}
