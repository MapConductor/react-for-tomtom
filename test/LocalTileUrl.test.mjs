import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';

// The tile URLs MapLibre fetches through the custom protocol when there is no
// Service Worker. `@2x` asks for a tile drawn at two device pixels per CSS
// pixel, as in the Service Worker's URLs; without it the tile is 1x, as before.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/local-tile-url-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: { url: 'src/marker/localTileUrl.ts' },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
    external: ['@mapconductor/js-sdk-core'],
});
const { localTileUrlTemplate, parseLocalTileUrl } = await import(pathToFileURL(resolve(outDir, 'url.mjs')));

const tile = (template) => template.replace('{z}', '16').replace('{x}', '58211').replace('{y}', '25803');

test('1x tiles keep the URLs they always had', () => {
    const template = localTileUrlTemplate({ routeId: 'mc-tile-a', tileSize: 256, cacheKey: '3' });
    assert.equal(template, 'mc-local-tile://mc-tile-a/256/3/{z}/{x}/{y}.png');
    assert.deepEqual(parseLocalTileUrl(tile(template)),
        { routeId: 'mc-tile-a', x: 58211, y: 25803, z: 16, pixelRatio: 1 });
});

test('a 2x tile says so in its URL and the protocol handler reads it back', () => {
    const template = localTileUrlTemplate({ routeId: 'mc-tile-a', tileSize: 256, cacheKey: '3', pixelRatio: 2 });
    assert.equal(template, 'mc-local-tile://mc-tile-a/256/3/{z}/{x}/{y}@2x.png');
    assert.deepEqual(parseLocalTileUrl(tile(template)),
        { routeId: 'mc-tile-a', x: 58211, y: 25803, z: 16, pixelRatio: 2 });
});

test('URLs without a cache key, and ones that name no tile', () => {
    assert.equal(parseLocalTileUrl('mc-local-tile://r/256/16/1/2@2x.png').pixelRatio, 2);
    assert.equal(parseLocalTileUrl('mc-local-tile://r/256/16/1/2.jpg'), null);
    assert.equal(parseLocalTileUrl('mc-local-tile://r/256/16/1'), null);
});
