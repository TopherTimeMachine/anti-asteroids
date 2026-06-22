import { randomBytes } from 'node:crypto';

const ASSET_URL_PATTERN =
  /((?:src|href)=["'])(\/[^"']+\.(?:js|css|mjs|ts))(?:\?[^"']*)?(["'])/gi;

/** Append a fresh random query key to local script/style URLs so each page load fetches new assets. */
export function injectLoadCacheBust(html: string): string {
  const key = randomBytes(8).toString('hex');
  return html.replace(ASSET_URL_PATTERN, `$1$2?k=${key}$3`);
}
