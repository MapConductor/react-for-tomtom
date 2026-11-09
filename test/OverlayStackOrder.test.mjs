import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';
import {
    createGeoPoint,
    createGeoRectBounds,
    createGroundImageState,
    createRasterLayerState,
    RasterLayerSource,
} from '@mapconductor/js-sdk-core';

// The overlay stack, bottom to top, on every provider: raster < ground image < polygon <
// circle < polyline < marker (js-sdk-core OVERLAY_STACK_ORDER), whatever order the overlays
// were added in, re-sent in after clearOverlays(), or put back in after a style swap.
//
// It used to depend on all three: polygons went in "before the polyline layer", circles
// "before the polygon fill" (so under the polygons), ground images and polylines at the top.
// A ground image re-sent after clearOverlays() covered the polygons.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/stack-order-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: {
        polygon: 'src/polygon/TomTomPolygonLayer.ts',
        circle: 'src/circle/TomTomCircleLayer.ts',
        polyline: 'src/polyline/TomTomPolylineLayer.ts',
        ground: 'src/groundimage/TomTomGroundImageOverlayRenderer.ts',
        raster: 'src/raster/TomTomRasterLayerOverlayRenderer.ts',
    },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
});
const load = async (name) => import(pathToFileURL(resolve(outDir, `${name}.mjs`)));
const { TomTomPolygonLayer } = await load('polygon');
const { TomTomCircleLayer } = await load('circle');
const { TomTomPolylineLayer } = await load('polyline');
const { TomTomGroundImageOverlayRenderer } = await load('ground');
const { TomTomRasterLayerOverlayRenderer } = await load('raster');

const BASEMAP = [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill' },
    { id: 'place-label', type: 'symbol' },
];

/** Enough of a GL map: an ordered layer list with addLayer(layer, beforeId). */
function glMap() {
    const sources = new Map();
    const layers = new Map();
    let order = [];
    const add = (layer, before) => {
        assert.ok(!layers.has(layer.id), `${layer.id} added twice`);
        if (before != null) assert.ok(layers.has(before), `beforeId ${before} is not on the map`);
        layers.set(layer.id, { paint: {}, ...layer });
        const at = before ? order.indexOf(before) : -1;
        if (at >= 0) order.splice(at, 0, layer.id); else order.push(layer.id);
    };
    const map = {
        order: () => [...order],
        swapStyle() {
            sources.clear(); layers.clear(); order = [];
            for (const layer of BASEMAP) add(layer);
        },
        getStyle: () => ({ layers: order.map((id) => layers.get(id)) }),
        getLayersOrder: () => [...order],
        getSource: (id) => sources.get(id),
        getLayer: (id) => layers.get(id),
        addSource: (id, source) => { sources.set(id, { ...source, setData() {}, updateImage() {}, setCoordinates() {} }); },
        addLayer: (layer, before) => add(layer, before),
        removeLayer: (id) => { layers.delete(id); order = order.filter((x) => x !== id); },
        removeSource: (id) => { sources.delete(id); },
        setPaintProperty: (id, property, value) => { layers.get(id).paint[property] = value; },
        setLayoutProperty() {},
        moveLayer: (id, before) => {
            order = order.filter((x) => x !== id);
            const at = before ? order.indexOf(before) : -1;
            if (at >= 0) order.splice(at, 0, id); else order.push(id);
        },
    };
    map.swapStyle();
    return map;
}

function overlays(map) {
    const holder = { map };
    const canEditStyle = () => true;
    const polygon = new TomTomPolygonLayer({ holder, canEditStyle });
    const circle = new TomTomCircleLayer({ holder, canEditStyle });
    const polyline = new TomTomPolylineLayer({ holder, canEditStyle });
    const ground = new TomTomGroundImageOverlayRenderer({ holder, canEditStyle });
    const raster = new TomTomRasterLayerOverlayRenderer(holder, canEditStyle);
    const gi = createGroundImageState({
        id: 'GI',
        bounds: createGeoRectBounds({
            southWest: createGeoPoint({ latitude: 35.66, longitude: 139.73 }),
            northEast: createGeoPoint({ latitude: 35.69, longitude: 139.77 }),
        }),
        imageUrl: '/image.png',
    });
    const rl = createRasterLayerState({
        id: 'RL',
        source: RasterLayerSource.UrlTemplate({ template: 'https://example.test/{z}/{x}/{y}.png', tileSize: 256 }),
    });
    return {
        raster: () => raster.onAdd([{ state: rl }]),
        ground: () => ground.createGroundImage(gi),
        polygon: () => polygon.draw([]),
        circle: () => circle.draw([]),
        polyline: () => polyline.draw([]),
        rasterRenderer: raster,
        groundRenderer: ground,
        gi, rl,
    };
}

// Ours, bottom to top. The raster also stays under the basemap's labels (unchanged).
const WANT = [
    'mc-raster-lyr-RL',
    'place-label',
    'mc-gimg-lyr-GI',
    'polygon-fill-layer',
    'polygon-outline-layer',
    'circle-layer',
    'circle-layer-stroke',
    'polyline-layer',
];

const ours = (order) => order.filter((id) => WANT.includes(id));

function* permutations(items) {
    if (items.length <= 1) { yield items; return; }
    for (let i = 0; i < items.length; i++) {
        for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
    }
}

const KINDS = ['raster', 'ground', 'polygon', 'circle', 'polyline'];

test('the stack is the same whatever order the overlays are added in', async () => {
    for (const perm of permutations(KINDS)) {
        const map = glMap();
        const o = overlays(map);
        for (const kind of perm) await o[kind]();
        assert.deepEqual(ours(map.order()), WANT, perm.join(' → '));
    }
});

test('a ground image and a raster re-sent after the others go back to their bands', async () => {
    // What clearOverlays() + sending everything again does: the vector layers stay (their
    // sources are only emptied), the ground image and the raster are removed and added again.
    const map = glMap();
    const o = overlays(map);
    for (const kind of KINDS) await o[kind]();
    await o.groundRenderer.removeGroundImage({ groundImage: 'GI', state: o.gi });
    await o.rasterRenderer.onRemove([{ layer: { sourceId: 'mc-raster-src-RL', layerId: 'mc-raster-lyr-RL' }, state: o.rl }]);
    await o.ground();
    await o.raster();
    assert.deepEqual(ours(map.order()), WANT);
});

test('after a style swap the overlays come back in their bands, in any order', async () => {
    for (const perm of [[...KINDS].reverse(), ['polyline', 'raster', 'circle', 'ground', 'polygon']]) {
        const map = glMap();
        const o = overlays(map);
        for (const kind of KINDS) await o[kind]();
        map.swapStyle();
        for (const kind of perm) await o[kind]();
        assert.deepEqual(ours(map.order()), WANT, perm.join(' → '));
    }
});

test('rasters keep their zIndex order among themselves, under everything else', async () => {
    const map = glMap();
    const o = overlays(map);
    await o.polygon();
    const state = (id, zIndex) => createRasterLayerState({
        id, zIndex,
        source: RasterLayerSource.UrlTemplate({ template: `https://example.test/${id}/{z}/{x}/{y}.png`, tileSize: 256 }),
    });
    await o.rasterRenderer.onAdd([{ state: state('high', 2) }, { state: state('low', -1) }, { state: state('mid', 0) }]);
    const order = map.order();
    const ids = ['mc-raster-lyr-low', 'mc-raster-lyr-mid', 'mc-raster-lyr-high', 'polygon-fill-layer'];
    assert.deepEqual(order.filter((id) => ids.includes(id)), ids);
});
