/**
 * Pure Telegram message formatting utilities.
 * All HTML escaping and URL normalization for Telegram Bot API responses.
 */

/**
 * Escape a string for safe embedding in Telegram HTML parse_mode messages.
 * Prevents injection of HTML tags or entities from user-supplied data
 * (e.g. Telegram first names containing `<`, `&`, or `>`).
 */
export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Normalize a Mini App base URL for use in Telegram `web_app` buttons.
 * - Trims whitespace
 * - Validates HTTPS protocol (Telegram requires HTTPS for WebApp URLs)
 * - Strips trailing slashes to prevent double-slash path joins
 *
 * Returns `undefined` if the URL is empty, missing, or not HTTPS.
 */
export function normalizeHttpsMiniappUrl(
  rawUrl?: string,
): string | undefined {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return undefined;
    // Remove trailing slash(es) from the full URL string
    return trimmed.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Build a full Mini App path URL by safely joining the normalized base URL
 * and a relative path (e.g. `/wallet`).
 *
 * Prevents double-slash artifacts like `https://example.com//wallet`.
 */
export function buildMiniappPathUrl(
  baseUrl: string,
  path: string,
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Build a Mini App URL with an optional `startapp` query parameter
 * for Telegram deep-link payloads.
 */
export function buildMiniappStartUrl(
  baseUrl: string,
  startParam?: string,
): string {
  if (!startParam?.trim()) return baseUrl;

  const url = new URL(baseUrl);
  url.searchParams.set('startapp', startParam.trim());
  return url.toString();
}
