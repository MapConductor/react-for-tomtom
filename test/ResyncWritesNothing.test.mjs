import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';
import { createGeoPoint, createPolylineState, PolylineManager } from '@mapconductor/js-sdk-core';

// The provider marks the style "not ready" on a styledata that arrives while a source is
// still loading, and resyncs every overlay on the idle that follows. A resync that rewrote
// unchanged sources (setData) or re-moved layers that were already on top (moveLayer) fired
// another styledata, so the style flipped between ready and not ready every ~0.3 s forever.
// These tests pin "a resync with nothing to do writes nothing", and that a lost style is
// still rebuilt.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/resync-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: {
        helpers: 'src/helpers.ts',
        controller: 'src/polyline/TomTomPolylineController.ts',
        renderer: 'src/polyline/TomTomPolylineOverlayRenderer.ts',
        layer: 'src/polyline/TomTomPolylineLayer.ts',
    },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
});
const { bringMarkerLayersToFront, setSourceFeatures } = await import(pathToFileURL(resolve(outDir, 'helpers.mjs')));
const { TomTomPolylineController } = await import(pathToFileURL(resolve(outDir, 'controller.mjs')));
const { TomTomPolylineOverlayRenderer } = await import(pathToFileURL(resolve(outDir, 'renderer.mjs')));
const { TomTomPolylineLayer } = await import(pathToFileURL(resolve(outDir, 'layer.mjs')));

function fakeMap(initialLayers = ['background', 'road-label']) {
    const writes = { setData: 0, moveLayer: 0, addSource: 0, addLayer: 0 };
    let sources = new Map();
    let order = [...initialLayers];
    const layers = new Map(initialLayers.map((id) => [id, { id }]));
    const map = {
        writes,
        get order() { return [...order]; },
        getLayersOrder: () => [...order],
        style: { get order() { return [...order]; } },
        getStyle: () => ({ layers: order.map((id) => layers.get(id)) }),
        getSource: (id) => sources.get(id),
        getLayer: (id) => layers.get(id),
        addSource(id) {
            writes.addSource++;
            sources.set(id, { setData() { writes.setData++; } });
        },
        addLayer(layer, before) {
            writes.addLayer++;
            layers.set(layer.id, layer);
            const at = before ? order.indexOf(before) : -1;
            if (at >= 0) order.splice(at, 0, layer.id); else order.push(layer.id);
        },
        moveLayer(id, before) {
            writes.moveLayer++;
            order = order.filter((x) => x !== id);
            const at = before ? order.indexOf(before) : -1;
            if (at >= 0) order.splice(at, 0, id); else order.push(id);
        },
        // A style swap drops every source and layer the SDK added.
        reloadStyle() {
            sources = new Map();
            order = order.filter((id) => !id.startsWith('mc-') && !id.startsWith('polyline'));
            for (const id of [...layers.keys()]) if (!order.includes(id)) layers.delete(id);
        },
    };
    return map;
}

test('bringMarkerLayersToFront moves nothing when the marker layers are already on top', () => {
    const map = fakeMap(['background', 'mc-marker-layer', 'mc-marker-drag-layer']);
    bringMarkerLayersToFront(map);
    assert.equal(map.writes.moveLayer, 0);
});

test('bringMarkerLayersToFront moves the marker layers once, then leaves them alone', () => {
    const map = fakeMap(['background', 'mc-marker-layer', 'mc-marker-drag-layer']);
    map.addLayer({ id: 'polyline-layer' });
    bringMarkerLayersToFront(map);
    assert.deepEqual(map.order.slice(-2), ['mc-marker-layer', 'mc-marker-drag-layer']);
    const moved = map.writes.moveLayer;
    assert.ok(moved > 0);
    bringMarkerLayersToFront(map);
    bringMarkerLayersToFront(map);
    assert.equal(map.writes.moveLayer, moved);
});

test('setSourceFeatures skips identical features but writes to a replaced source', () => {
    let calls = 0;
    const source = { setData() { calls++; } };
    const a = { type: 'Feature' };
    const b = { type: 'Feature' };
    setSourceFeatures(source, [a, b]);
    setSourceFeatures(source, [a, b]);
    assert.equal(calls, 1);
    setSourceFeatures(source, [b, a]);
    assert.equal(calls, 2, 'a different order is a change');
    setSourceFeatures(source, [b]);
    assert.equal(calls, 3, 'a removed feature is a change');
    const replaced = { setData() { calls++; } };
    setSourceFeatures(replaced, [b]);
    assert.equal(calls, 4, 'a new source object (style swap) is always written');
});

test('resync with nothing changed writes nothing; after a style swap it rebuilds', async () => {
    const map = fakeMap(['background', 'road-label', 'mc-marker-layer', 'mc-marker-drag-layer']);
    const holder = { map };
    const layer = new TomTomPolylineLayer({ holder, canEditStyle: () => true });
    const renderer = new TomTomPolylineOverlayRenderer({ layer, polylineManager: new PolylineManager(), holder });
    const controller = new TomTomPolylineController(renderer);
    await controller.add([createPolylineState({
        id: 'PL',
        points: [createGeoPoint({ latitude: 35, longitude: 139 }), createGeoPoint({ latitude: 36, longitude: 140 })],
    })]);
    const afterAdd = { ...map.writes };
    assert.ok(afterAdd.setData > 0);

    await controller.resync();
    await controller.resync();
    assert.deepEqual(map.writes, afterAdd, 'a resync with nothing to do must not touch the style');

    map.reloadStyle();
    await controller.resync();
    assert.ok(map.getSource('polyline-source'), 'the lost source is added again');
    assert.ok(map.writes.setData > afterAdd.setData, 'and its data written again');
    assert.ok(map.order.includes('polyline-layer'), 'and its layer');
});
