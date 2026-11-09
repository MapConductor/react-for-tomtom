import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';
import { createGeoPoint, createGeoRectBounds, createGroundImageState } from '@mapconductor/js-sdk-core';

// Exercise the actual internal classes without exporting them as public API.
// Only the map is replaced; no DOM, WebGL, or network is needed.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/groundimage-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: {
        controller: 'src/groundimage/TomTomGroundImageController.ts',
        renderer: 'src/groundimage/TomTomGroundImageOverlayRenderer.ts',
    },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
});
const { TomTomGroundImageController } = await import(pathToFileURL(resolve(outDir, 'controller.mjs')));
const { TomTomGroundImageOverlayRenderer } = await import(pathToFileURL(resolve(outDir, 'renderer.mjs')));

const sourceId = 'mc-gimg-src-GI';
const layerId = 'mc-gimg-lyr-GI';

function state(opacity = 0.9) {
    return createGroundImageState({
        id: 'GI',
        bounds: createGeoRectBounds({
            southWest: createGeoPoint({ latitude: 35.64, longitude: 139.74 }),
            northEast: createGeoPoint({ latitude: 35.665, longitude: 139.78 }),
        }),
        imageUrl: '/image.png',
        opacity,
    });
}

function fixture() {
    const sources = new Map();
    const layers = new Map();
    let ready = true;
    const map = {
        getSource: (id) => sources.get(id),
        getLayer: (id) => layers.get(id),
        addSource(id, source) {
            assert.ok(ready, 'cannot add a source while the style is unavailable');
            assert.ok(!sources.has(id));
            sources.set(id, { ...source, updateImage() {}, setCoordinates() {} });
        },
        addLayer(layer) {
            assert.ok(ready, 'cannot add a layer while the style is unavailable');
            assert.ok(sources.has(layer.source));
            assert.ok(!layers.has(layer.id));
            layers.set(layer.id, layer);
        },
        removeLayer(id) {
            assert.ok(ready, 'cannot remove a layer while the style is unavailable');
            layers.delete(id);
        },
        removeSource(id) {
            assert.ok(ready, 'cannot remove a source while the style is unavailable');
            assert.ok(![...layers.values()].some((layer) => layer.source === id));
            sources.delete(id);
        },
        setPaintProperty(id, property, value) {
            layers.get(id).paint[property] = value;
        },
        moveLayer() {},
    };
    const renderer = new TomTomGroundImageOverlayRenderer({ holder: { map }, canEditStyle: () => ready });
    const controller = new TomTomGroundImageController(renderer);
    return {
        controller,
        setReady(value) { ready = value; },
        onMap: () => sources.has(sourceId) || layers.has(layerId),
    };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('a removal while the style is not editable is applied once it is', async () => {
    const f = fixture();
    f.controller.composition([state()]);
    await settle();
    assert.ok(f.onMap());

    // clearOverlays() runs right after other overlays rewrote their sources,
    // when isStyleLoaded() -- and so canEditStyle -- is briefly false.
    f.setReady(false);
    f.controller.clear();
    await settle();
    assert.equal(f.controller.hasId('GI'), false);

    f.setReady(true);
    f.controller.resync();
    await settle();
    assert.equal(f.onMap(), false, 'the cleared ground image is still on the map');
});

test('adding the same id again before the style is editable keeps it', async () => {
    const f = fixture();
    f.controller.composition([state()]);
    await settle();

    f.setReady(false);
    f.controller.clear();
    await settle();
    f.controller.composition([state(0.4)]);
    await settle();

    f.setReady(true);
    f.controller.resync();
    await settle();
    assert.ok(f.onMap(), 'the re-added ground image was removed');
    assert.equal(f.controller.hasId('GI'), true);
});

test('a removal while the style is editable is applied at once', async () => {
    const f = fixture();
    f.controller.composition([state()]);
    await settle();
    f.controller.composition([]);
    await settle();
    assert.equal(f.onMap(), false);
});
