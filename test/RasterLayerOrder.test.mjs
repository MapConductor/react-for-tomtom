import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';
import { createRasterLayerState, RasterLayerSource } from '@mapconductor/js-sdk-core';

// clearOverlays() leaves the polygon / polyline / circle layers in the style (their sources
// are just emptied). A raster added after that was appended at the top of the style, so
// sending the same overlays again drew the raster over the polygons. The same happened on any
// raster update that replaced its source. The other GL providers insert a raster below the
// basemap's first label layer; TomTom now does the same.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/raster-order-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: {
        controller: 'src/raster/TomTomRasterLayerController.ts',
        renderer: 'src/raster/TomTomRasterLayerOverlayRenderer.ts',
    },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
});
const { TomTomRasterLayerController } = await import(pathToFileURL(resolve(outDir, 'controller.mjs')));
const { TomTomRasterLayerOverlayRenderer } = await import(pathToFileURL(resolve(outDir, 'renderer.mjs')));

function fixture() {
    const sources = new Map();
    const layers = new Map();
    let order = [];
    const add = (layer, before) => {
        layers.set(layer.id, layer);
        const at = before ? order.indexOf(before) : -1;
        if (at >= 0) order.splice(at, 0, layer.id); else order.push(layer.id);
    };
    // Basemap: a fill, then its first label layer.
    add({ id: 'land', type: 'fill' });
    add({ id: 'place-label', type: 'symbol' });
    // What clearOverlays() leaves behind: our vector overlay layers, still in the style.
    add({ id: 'polygon-fill-layer', type: 'fill' });
    add({ id: 'mc-marker-layer', type: 'symbol' });
    const map = {
        order: () => [...order],
        getStyle: () => ({ layers: order.map((id) => layers.get(id)) }),
        getLayersOrder: () => [...order],
        getSource: (id) => sources.get(id),
        getLayer: (id) => layers.get(id),
        addSource: (id, source) => { sources.set(id, source); },
        addLayer: (layer, before) => add(layer, before),
        removeLayer: (id) => { layers.delete(id); order = order.filter((x) => x !== id); },
        removeSource: (id) => { sources.delete(id); },
        setPaintProperty: (id, property, value) => { layers.get(id).paint[property] = value; },
        moveLayer: (id, before) => {
            order = order.filter((x) => x !== id);
            const at = before ? order.indexOf(before) : -1;
            if (at >= 0) order.splice(at, 0, id); else order.push(id);
        },
    };
    const renderer = new TomTomRasterLayerOverlayRenderer({ map }, () => true);
    const controller = new TomTomRasterLayerController(renderer);
    return { map, controller };
}

function relief(opacity) {
    return createRasterLayerState({
        id: 'RL',
        opacity,
        source: RasterLayerSource.UrlTemplate({ template: 'https://example.test/{z}/{x}/{y}.png', tileSize: 256 }),
    });
}

test('a raster added after the vector overlays goes under them and under the basemap labels', async () => {
    const f = fixture();
    await f.controller.composition([relief(0.5)]);
    const order = f.map.order();
    assert.ok(order.indexOf('mc-raster-lyr-RL') < order.indexOf('place-label'), order.join(' > '));
    assert.ok(order.indexOf('mc-raster-lyr-RL') < order.indexOf('polygon-fill-layer'), order.join(' > '));
});

test('replacing the raster source keeps it under the vector overlays', async () => {
    const f = fixture();
    await f.controller.composition([relief(0.5)]);
    // A new source object (as a re-render creates) is a source replacement: remove + add.
    await f.controller.composition([relief(0.3)]);
    const order = f.map.order();
    assert.ok(order.indexOf('mc-raster-lyr-RL') < order.indexOf('polygon-fill-layer'), order.join(' > '));
});
