import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';
import { createGeoPoint, createPolygonState, PolygonManager } from '@mapconductor/js-sdk-core';

// ポリゴンのコントローラを、地図だけ差し替えて実クラスで動かす。
// 塗り（fill レイヤー）と輪郭（line レイヤー、線幅つき）が 1 つのレンダラーから
// 描かれること、差分・クリア・再同期・タップ配送が core の PolygonController 経由で
// 正しく地図に届くことを確かめる。DOM も WebGL も要らない。
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(fileURLToPath(new URL('../build/polygon-tests-', import.meta.url)));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: {
        controller: 'src/polygon/TomTomPolygonController.ts',
        renderer: 'src/polygon/TomTomPolygonOverlayRenderer.ts',
        layer: 'src/polygon/TomTomPolygonLayer.ts',
    },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
});
const { TomTomPolygonController: Controller } = await import(pathToFileURL(resolve(outDir, 'controller.mjs')));
const { TomTomPolygonOverlayRenderer } = await import(pathToFileURL(resolve(outDir, 'renderer.mjs')));
const { TomTomPolygonLayer } = await import(pathToFileURL(resolve(outDir, 'layer.mjs')));

const FILL_SOURCE = 'polygon-fill-source';
const OUTLINE_SOURCE = 'polygon-outline-source';
const FILL_LAYER = 'polygon-fill-layer';
const OUTLINE_LAYER = 'polygon-outline-layer';

function fixture({ existingLayers = [] } = {}) {
    const sources = new Map();
    const order = [...existingLayers.map((id) => ({ id }))];
    let ready = true;
    const map = {
        getSource: (id) => sources.get(id),
        getLayer: (id) => order.find((layer) => layer.id === id),
        // The real map's layer order: the stacking (overlayStackBeforeId) reads it to place new layers.
        getLayersOrder: () => order.map((layer) => layer.id),
        addSource(id, spec) {
            assert.ok(ready, 'cannot add a source while the style is unavailable');
            const source = { spec, data: spec.data, setData(data) { this.data = data; } };
            sources.set(id, source);
        },
        addLayer(layer, beforeId) {
            assert.ok(ready, 'cannot add a layer while the style is unavailable');
            assert.ok(sources.has(layer.source));
            const index = beforeId ? order.findIndex((l) => l.id === beforeId) : -1;
            if (index < 0) order.push(layer);
            else order.splice(index, 0, layer);
        },
        moveLayer(id) {
            const index = order.findIndex((l) => l.id === id);
            const [layer] = order.splice(index, 1);
            order.push(layer);
        },
    };
    const holder = { map };
    const polygonManager = new PolygonManager();
    const layer = new TomTomPolygonLayer({ holder, canEditStyle: () => ready });
    const renderer = new TomTomPolygonOverlayRenderer({ layer, polygonManager, holder });
    const controller = new Controller(renderer);
    return {
        map, controller, polygonManager,
        setReady(value) { ready = value; },
        reloadStyle() { ready = false; sources.clear(); order.splice(0, order.length, ...existingLayers.map((id) => ({ id }))); },
        fills: () => sources.get(FILL_SOURCE)?.data.features ?? [],
        outlines: () => sources.get(OUTLINE_SOURCE)?.data.features ?? [],
        layerOrder: () => order.map((l) => l.id),
        layer: (id) => order.find((l) => l.id === id),
    };
}

const ring = (points) => points.map((p) => createGeoPoint(p));
const square = ring([
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 10 },
    { latitude: 10, longitude: 10 },
    { latitude: 10, longitude: 0 },
]);
const hole = ring([
    { latitude: 4, longitude: 4 },
    { latitude: 4, longitude: 6 },
    { latitude: 6, longitude: 6 },
    { latitude: 6, longitude: 4 },
]);

function polygon(id, overrides = {}) {
    return createPolygonState({
        id,
        points: square,
        strokeColor: '#ff0000',
        strokeWidth: 6,
        fillColor: 'rgba(0, 0, 255, 0.5)',
        ...overrides,
    });
}

test('composition draws the fill and a width-carrying outline from one renderer', async () => {
    const f = fixture();
    await f.controller.composition([polygon('a', { holes: [hole] })]);

    assert.equal(f.fills().length, 1);
    const fill = f.fills()[0];
    assert.equal(fill.properties.fillColor, 'rgba(0, 0, 255, 0.5)');
    assert.equal(fill.geometry.coordinates.length, 2, 'outer ring + hole');

    assert.ok(f.outlines().length >= 1);
    for (const outline of f.outlines()) {
        assert.equal(outline.geometry.type, 'LineString');
        assert.equal(outline.properties.strokeColor, '#ff0000');
        assert.equal(outline.properties.strokeWidth, 6);
    }
    assert.equal(f.layer(FILL_LAYER).type, 'fill');
    assert.equal(f.layer(OUTLINE_LAYER).type, 'line');
    assert.deepEqual(f.layer(OUTLINE_LAYER).paint['line-width'], ['get', 'strokeWidth']);
    assert.equal(f.controller.has(polygon('a')), true);
    assert.equal(f.controller.hasId('a'), true);
    assert.equal(f.controller.has(polygon('b')), false);
});

test('features are ordered by zIndex and carry it for the sort keys', async () => {
    const f = fixture();
    await f.controller.composition([polygon('top', { zIndex: 5 }), polygon('bottom', { zIndex: 1 })]);
    assert.deepEqual(f.fills().map((feature) => feature.properties.id), ['bottom', 'top']);
    assert.deepEqual(f.fills().map((feature) => feature.properties.zIndex), [1, 5]);
});

test('layers are placed under existing polylines and markers', async () => {
    const f = fixture({ existingLayers: ['polyline-layer', 'mc-marker-layer'] });
    await f.controller.composition([polygon('a')]);
    assert.deepEqual(f.layerOrder(), [FILL_LAYER, OUTLINE_LAYER, 'polyline-layer', 'mc-marker-layer']);

    const g = fixture({ existingLayers: ['mc-marker-layer'] });
    await g.controller.composition([polygon('a')]);
    assert.deepEqual(g.layerOrder(), [FILL_LAYER, OUTLINE_LAYER, 'mc-marker-layer']);

    const h = fixture({ existingLayers: ['mc-raster-lyr-mc-marker-tiles'] });
    await h.controller.composition([polygon('a')]);
    assert.equal(h.layerOrder().at(-1), 'mc-raster-lyr-mc-marker-tiles', 'marker tiles stay on top');
});

test('composition updates colours and points in place and removes missing ids', async () => {
    const f = fixture();
    await f.controller.composition([polygon('a'), polygon('b', { zIndex: 1 })]);
    const moved = ring(square.map((p) => ({ latitude: p.latitude + 20, longitude: p.longitude })));
    await f.controller.composition([polygon('a', { fillColor: '#00ff00', strokeColor: '#000000', strokeWidth: 3, points: moved })]);

    assert.deepEqual(f.fills().map((feature) => feature.properties.id), ['a']);
    assert.equal(f.fills()[0].properties.fillColor, '#00ff00');
    assert.equal(f.fills()[0].geometry.coordinates[0][0][1], 20);
    assert.equal(f.outlines()[0].properties.strokeColor, '#000000');
    assert.equal(f.outlines()[0].properties.strokeWidth, 3);
    assert.equal(f.controller.has(polygon('b')), false);
});

test('update() redraws a single polygon', async () => {
    const f = fixture();
    await f.controller.composition([polygon('a'), polygon('b')]);
    await f.controller.update(polygon('a', { fillColor: '#123456', strokeWidth: 9 }));
    const a = f.fills().find((feature) => feature.properties.id === 'a');
    assert.equal(a.properties.fillColor, '#123456');
    assert.equal(f.outlines().find((feature) => feature.properties.id === 'outline-a').properties.strokeWidth, 9);
    assert.equal(f.fills().length, 2);
});

test('clear() empties both sources', async () => {
    const f = fixture();
    await f.controller.composition([polygon('a'), polygon('b')]);
    await f.controller.clear();
    assert.equal(f.fills().length, 0);
    assert.equal(f.outlines().length, 0);
    assert.equal(f.controller.has(polygon('a')), false);
});

test('resync restores the layers after a style reload', async () => {
    const f = fixture();
    await f.controller.composition([polygon('a')]);
    f.reloadStyle();
    await f.controller.resync();
    assert.equal(f.fills().length, 0);
    f.setReady(true);
    await f.controller.resync();
    assert.equal(f.fills().length, 1);
    assert.ok(f.layer(FILL_LAYER));
    assert.ok(f.layer(OUTLINE_LAYER));
});

test('a polygon added before the style is ready is drawn on resync', async () => {
    const f = fixture();
    f.setReady(false);
    await f.controller.composition([polygon('a')]);
    assert.equal(f.controller.has(polygon('a')), true);
    f.setReady(true);
    await f.controller.resync();
    assert.equal(f.fills().length, 1);
});

test('resolveTap hits the top-most polygon, skips holes, and dispatches onClick + listener', async () => {
    const f = fixture();
    const clicks = [];
    const listened = [];
    await f.controller.composition([
        polygon('low', { zIndex: 1, onClick: (event) => clicks.push(['low', event]) }),
        polygon('high', { zIndex: 2, holes: [hole], onClick: (event) => clicks.push(['high', event]) }),
    ]);
    f.controller.setClickListenerAny((event) => listened.push(event.state.id));

    const hit = f.controller.resolveTap({ latitude: 1, longitude: 1 });
    assert.ok(hit);
    assert.equal(hit.kind, 'polygon');
    hit.dispatch();
    assert.equal(clicks.at(-1)[0], 'high');
    assert.equal(clicks.at(-1)[1].clicked.latitude, 1);
    assert.deepEqual(listened, ['high']);

    // 上のポリゴンの穴は下のポリゴンに抜ける。
    f.controller.resolveTap({ latitude: 5, longitude: 5 }).dispatch();
    assert.equal(clicks.at(-1)[0], 'low');

    assert.equal(f.controller.resolveTap({ latitude: 30, longitude: 30 }), null);
});

test('resolveTap dispatches the newest handler after a re-composition', async () => {
    const f = fixture();
    let which = '';
    await f.controller.composition([polygon('a', { onClick: () => { which = 'old'; } })]);
    await f.controller.composition([polygon('a', { onClick: () => { which = 'new'; } })]);
    f.controller.resolveTap({ latitude: 1, longitude: 1 }).dispatch();
    assert.equal(which, 'new');
});

test('clicked points are wrapped across the antimeridian', async () => {
    const f = fixture();
    let clicked = null;
    const wide = ring([
        { latitude: 0, longitude: 170 },
        { latitude: 0, longitude: 190 },
        { latitude: 10, longitude: 190 },
        { latitude: 10, longitude: 170 },
    ]);
    await f.controller.composition([polygon('a', { points: wide, onClick: (event) => { clicked = event.clicked; } })]);
    const hit = f.controller.resolveTap({ latitude: 5, longitude: 185 });
    assert.ok(hit);
    hit.dispatch();
    assert.equal(clicked.longitude, -175);
});
