import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';
import { createRasterLayerState, RasterLayerSource } from '@mapconductor/js-sdk-core';

// Exercise the actual internal classes without exporting them as public API.
// Only the TomTom map is replaced; no DOM, WebGL, or Service Worker is needed.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/raster-tests-', import.meta.url));
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

const sourceId = 'mc-raster-src-mc-marker-tiles';
const layerId = 'mc-raster-lyr-mc-marker-tiles';

function state(version, opacity = 1) {
    return createRasterLayerState({
        id: 'mc-marker-tiles',
        opacity,
        source: RasterLayerSource.UrlTemplate({
            template: `/__tiles/markers/256/${version}/{z}/{x}/{y}.png`,
            tileSize: 256,
        }),
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
            assert.ok(!sources.has(id), 'source must be removed before replacement');
            sources.set(id, source);
        },
        addLayer(layer) {
            assert.ok(ready, 'cannot add a layer while the style is unavailable');
            assert.ok(sources.has(layer.source));
            assert.ok(!layers.has(layer.id));
            layers.set(layer.id, layer);
        },
        removeLayer(id) {
            assert.ok(ready);
            layers.delete(id);
        },
        removeSource(id) {
            assert.ok(ready);
            assert.ok(![...layers.values()].some((layer) => layer.source === id));
            sources.delete(id);
        },
        setPaintProperty(id, property, value) {
            assert.ok(ready);
            layers.get(id).paint[property] = value;
        },
        moveLayer() {},
    };
    const renderer = new TomTomRasterLayerOverlayRenderer({ map }, () => ready);
    const controller = new TomTomRasterLayerController(renderer);
    return {
        map, renderer, controller,
        setReady(value) { ready = value; },
        // A style reload drops every source and layer the SDK added.
        reloadStyle() { ready = false; sources.clear(); layers.clear(); },
        template: () => sources.get(sourceId)?.tiles[0],
        opacity: () => layers.get(layerId)?.paint['raster-opacity'],
        current: () => controller.rasterLayerManager.getEntity('mc-marker-tiles')?.state,
    };
}

test('source replacement while ready applies the new numbered-marker tiles', async () => {
    const f = fixture();
    await f.controller.composition([state('circle')]);
    const numbered = state('numbered');
    await f.controller.composition([numbered]);
    assert.equal(f.template(), numbered.source.template);
});

test('resync restores sources and layers lost during a style reload', async () => {
    const f = fixture();
    const numbered = state('numbered');
    await f.controller.composition([numbered]);
    const handle = f.controller.rasterLayerManager.getEntity(numbered.id).layer;
    f.map.removeLayer(layerId);
    f.map.removeSource(sourceId);
    f.setReady(false);
    await f.controller.resync();
    assert.equal(f.template(), undefined);
    f.setReady(true);
    await f.controller.resync();
    assert.equal(f.template(), numbered.source.template);
    assert.equal(f.controller.rasterLayerManager.getEntity(numbered.id).layer, handle);
    assert.ok(f.map.getLayer(layerId));
});

test('deferred source replacement survives until the style can be edited', async () => {
    const f = fixture();
    const circle = state('circle');
    await f.controller.composition([circle]);
    f.setReady(false);
    const numbered = state('numbered');
    await f.controller.composition([numbered]);
    assert.equal(f.template(), circle.source.template);
    assert.equal(f.current(), numbered);
    f.setReady(true);
    await f.controller.resync();
    assert.equal(f.template(), numbered.source.template);
    assert.ok(f.map.getLayer(layerId));
});

test('several changes while loading reapply the latest source', async () => {
    const f = fixture();
    await f.controller.composition([state('circle')]);
    f.setReady(false);
    for (const version of ['numbered', 'circle', 'panned']) {
        await f.controller.composition([state(version)]);
    }
    const latest = f.current();
    f.setReady(true);
    await f.controller.resync();
    await f.controller.resync();
    assert.equal(f.template(), latest.source.template);
    assert.equal(f.current(), latest);
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function pauseResync(f) {
    const started = deferred();
    const release = deferred();
    const onAdd = f.renderer.onAdd.bind(f.renderer);
    f.renderer.onAdd = async (data) => {
        const handles = await onAdd(data);
        started.resolve();
        await release.promise;
        return handles;
    };
    const pending = f.controller.resync();
    await started.promise;
    return { pending, release: release.resolve };
}

for (const method of ['composition', 'update']) {
    test(`resync cannot overwrite a newer ${method}`, async () => {
        const f = fixture();
        await f.controller.composition([state('circle')]);
        const resync = await pauseResync(f);
        const numbered = state('numbered');
        const change = f.controller[method](method === 'composition' ? [numbered] : numbered);
        resync.release();
        await resync.pending;
        await change;
        assert.equal(f.current(), numbered);
        assert.equal(f.template(), numbered.source.template);
    });
}

test('resync cannot resurrect a layer removed by clear', async () => {
    const f = fixture();
    await f.controller.composition([state('circle')]);
    const resync = await pauseResync(f);
    const clearing = f.controller.clear();
    resync.release();
    await resync.pending;
    await clearing;
    assert.equal(f.current(), undefined);
    assert.equal(f.map.getSource(sourceId), undefined);
    assert.equal(f.map.getLayer(layerId), undefined);
});

test('resync flushes deferred removals even when the manager is empty', async () => {
    const f = fixture();
    await f.controller.composition([state('circle')]);
    f.setReady(false);
    await f.controller.clear();
    assert.equal(f.current(), undefined);
    assert.ok(f.map.getSource(sourceId));
    f.setReady(true);
    await f.controller.resync();
    assert.equal(f.map.getSource(sourceId), undefined);
    assert.equal(f.map.getLayer(layerId), undefined);
});

// The opposite order to pauseResync(): a style event starts resync() while a
// change is between renderer.onChange() and registerEntity(). TomTom runs on
// maplibre-gl, which fires `styledata` synchronously from map.addImage()
// (Style#_afterImageUpdated), so a microtask that adds a marker image can land
// there.
function inChangeWindow(f, onWindow) {
    const onChange = f.renderer.onChange.bind(f.renderer);
    let pending = Promise.resolve();
    f.renderer.onChange = async (data) => {
        const handles = await onChange(data);
        queueMicrotask(() => { pending = onWindow(); });
        f.renderer.onChange = onChange;
        return handles;
    };
    return () => pending;
}

for (const method of ['composition', 'update']) {
    test(`style ready during a deferred ${method} keeps the new source`, async () => {
        const f = fixture();
        await f.controller.composition([state('circle')]);
        f.reloadStyle();
        const resynced = inChangeWindow(f, () => {
            f.setReady(true);
            return f.controller.resync();
        });
        const numbered = state('numbered');
        await f.controller[method](method === 'composition' ? [numbered] : numbered);
        await resynced();
        assert.equal(f.current(), numbered);
        assert.equal(f.template(), numbered.source.template);
    });

    test(`resync during an opacity ${method} keeps the new opacity`, async () => {
        const f = fixture();
        await f.controller.composition([state('circle', 1)]);
        const resynced = inChangeWindow(f, () => f.controller.resync());
        const faded = state('circle', 0.5);
        await f.controller[method](method === 'composition' ? [faded] : faded);
        await resynced();
        assert.equal(f.current(), faded);
        assert.equal(f.opacity(), 0.5);
    });
}
