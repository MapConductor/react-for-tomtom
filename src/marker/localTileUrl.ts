import { parseTilePixelRatio, tilePixelRatioSuffix } from '@mapconductor/js-sdk-core';

/**
 * Marker tiles fetched through MapLibre's custom protocol when no Service
 * Worker is available. The ratio suffix (`@2x`) means the same as in the
 * Service Worker's `/__tiles/` URLs.
 */
export const MAPCONDUCTOR_TILE_PROTOCOL = 'mc-local-tile';

// mc-local-tile://{routeId}/{tileSize}/{cacheKey?}/{z}/{x}/{y}{@2x?}.png
export function parseLocalTileUrl(
  urlString: string,
): { routeId: string; x: number; y: number; z: number; pixelRatio: number } | null {
  const url = new URL(urlString);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 && parts.length !== 5) return null;

  const offset = parts.length === 5 ? 1 : 0;
  const z = Number(parts[1 + offset]);
  const x = Number(parts[2 + offset]);
  const last = parts[3 + offset].match(/^(\d+)(@\d+x)?\.png$/);
  if (!last) return null;
  const y = Number(last[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

  return { routeId: url.hostname, x, y, z, pixelRatio: parseTilePixelRatio(last[2]) };
}

export function localTileUrlTemplate({
  routeId,
  tileSize,
  cacheKey,
  pixelRatio,
}: {
  routeId: string;
  tileSize: number;
  cacheKey?: string;
  pixelRatio?: number;
}): string {
  const base = `${MAPCONDUCTOR_TILE_PROTOCOL}://${routeId}/${tileSize}`;
  const tile = `{z}/{x}/{y}${tilePixelRatioSuffix(pixelRatio)}.png`;
  if (cacheKey) {
    return `${base}/${cacheKey}/${tile}`;
  }
  return `${base}/${tile}`;
}
