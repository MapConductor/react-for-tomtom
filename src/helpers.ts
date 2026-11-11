import type * as maplibregl from 'maplibre-gl';
import type { SourceSpecification } from 'maplibre-gl';
import { createGeoPoint, TileScheme, type GeoPoint, type GroundImageState, type PolygonState, RasterLayerSource, overlayStackBeforeId, type OverlayKind, type OverlayStackKey } from '@mapconductor/js-sdk-core';

export type Coordinate = [number, number];
export type GeoJSONSourceData = Parameters<maplibregl.GeoJSONSource['setData']>[0];

export type PointFeature = {
  type: 'Feature';
  id?: string | number;
  geometry: { type: 'Point'; coordinates: Coordinate };
  properties: Record<string, unknown>;
};

export type LineFeature = {
  type: 'Feature';
  id?: string | number;
  geometry: { type: 'LineString'; coordinates: Coordinate[] };
  properties: Record<string, unknown>;
};

export type PolygonFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: Coordinate[][] };
  properties: Record<string, unknown>;
};

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<PointFeature | LineFeature | PolygonFeature>;
};

export function lngLatFromEvent(e: { lngLat: { lat: number; lng: number } }): GeoPoint {
  return createGeoPoint({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
}

export function removeLayerIfExists(map: maplibregl.Map, layerId: string): void {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
}

export function removeSourceIfExists(map: maplibregl.Map, sourceId: string): void {
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

const MARKER_LAYER_IDS = ['mc-raster-lyr-mc-marker-tiles', 'mc-marker-layer', 'mc-marker-drag-layer'];

// The layer order this module last produced, per map. Lets bringMarkerLayersToFront tell
// "nothing moved since I arranged it" apart from "someone added a layer on top".
const arrangedOrders = new WeakMap<object, string>();

function currentLayerOrder(map: maplibregl.Map): string[] | null {
  try {
    const m = map as unknown as {
      getLayersOrder?: () => string[];
      style?: { order?: string[] };
      getStyle?: () => { layers?: Array<{ id: string }> } | undefined;
    };
    if (typeof m.getLayersOrder === 'function') return m.getLayersOrder();
    if (Array.isArray(m.style?.order)) return [...m.style!.order!];
    const layers = m.getStyle?.()?.layers;
    return layers ? layers.map((layer) => layer.id) : null;
  } catch {
    return null;
  }
}

/**
 * Keep the marker layers above every other layer.
 *
 * **Moves nothing when they already are.** `moveLayer` marks the style as changed even when
 * the layer stays where it was, and every change fires `styledata`. The provider treats a
 * `styledata` that arrives while sources are still loading as "style not ready", and the
 * `idle` that follows resyncs every overlay — which called this again. The style flipped
 * between ready and not ready about every 0.3 s, forever, with nothing on the map changing.
 */
export function bringMarkerLayersToFront(map: maplibregl.Map): void {
  const order = currentLayerOrder(map);
  if (order) {
    const present = MARKER_LAYER_IDS.filter((layerId) => order.includes(layerId));
    if (present.length === 0) return;
    const tail = order.slice(order.length - present.length);
    if (tail.every((layerId, i) => layerId === present[i])) return;
    if (arrangedOrders.get(map) === order.join('\n')) return;
  }
  for (const layerId of MARKER_LAYER_IDS) {
    try {
      if (map.getLayer(layerId)) map.moveLayer(layerId);
    } catch {
      continue;
    }
  }
  const arranged = currentLayerOrder(map);
  if (arranged) arrangedOrders.set(map, arranged.join('\n'));
}

// ── Overlay stacking ───────────────────────────────────────────────────────
//
// Bottom to top, on every provider: raster < ground image < polygon < circle < polyline <
// marker (js-sdk-core OVERLAY_STACK_ORDER). Every layer this SDK adds goes in with the
// beforeId from overlayLayerBeforeId(), so the order does not depend on the order things were
// added, re-sent after clearOverlays(), or put back after a style swap. It used to: polygons
// went in "before the polyline layer", circles "before the polygon fill" (under polygons),
// ground images and polylines at the top, so a ground image re-sent after the polygons covered
// them, and a raster added after clearOverlays() could cover everything.

export const MARKER_TILES_LAYER_ID = 'mc-raster-lyr-mc-marker-tiles';
/**
 * The raster layer of the SDK's polygon tiles (js-sdk-core POLYGON_TILE_LAYER_ID). It is in the
 * polygon band, under the polygons drawn as GeoJSON (geodesic ones), which stay on top.
 */
export const POLYGON_TILES_LAYER_ID = 'mc-raster-lyr-mc-polygon-tiles';
/**
 * The raster layer of the SDK's polyline tiles (js-sdk-core POLYLINE_TILE_LAYER_ID). It is in the
 * polyline band: over the circles, under the polylines drawn as GeoJSON (geodesic ones) and the
 * markers.
 */
export const POLYLINE_TILES_LAYER_ID = 'mc-raster-lyr-mc-polyline-tiles';
/**
 * The raster layer of the SDK's circle tiles (js-sdk-core CIRCLE_TILE_LAYER_ID). It is at the
 * bottom of the circle band: over the polygons (tiled or GeoJSON), under the circles drawn as
 * GeoJSON (those that cannot be tiled), the polylines and the markers.
 */
export const CIRCLE_TILES_LAYER_ID = 'mc-raster-lyr-mc-circle-tiles';

/** Layers with a fixed place: one per kind, holding every overlay of that kind. */
const FIXED_STACK_KEYS: Record<string, OverlayStackKey> = {
  [POLYGON_TILES_LAYER_ID]: { kind: 'polygon', sub: -1 },
  'polygon-fill-layer': { kind: 'polygon', sub: 0 },
  'polygon-outline-layer': { kind: 'polygon', sub: 1 },
  [CIRCLE_TILES_LAYER_ID]: { kind: 'circle', sub: -1 },
  'circle-layer': { kind: 'circle', sub: 0 },
  'circle-layer-stroke': { kind: 'circle', sub: 1 },
  [POLYLINE_TILES_LAYER_ID]: { kind: 'polyline', sub: -1 },
  'polyline-layer': { kind: 'polyline' },
  [MARKER_TILES_LAYER_ID]: { kind: 'marker', sub: 0 },
  'mc-marker-layer': { kind: 'marker', sub: 1 },
  'mc-marker-drag-layer': { kind: 'marker', sub: 2 },
};

// Layers holding one overlay each (rasters, ground images), per map: their zIndex and the
// order they were handed over in.
const itemStackKeys = new WeakMap<object, Map<string, OverlayStackKey>>();
const itemSequences = new WeakMap<object, number>();

/** Where a layer of ours belongs in the stack; null for the style's own layers. */
export function overlayStackKeyOf(map: object, layerId: string): OverlayStackKey | null {
  const fixed = FIXED_STACK_KEYS[layerId];
  if (fixed) return fixed;
  const item = itemStackKeys.get(map)?.get(layerId);
  if (item) return item;
  if (layerId.startsWith('mc-raster-lyr-')) return { kind: 'rasterLayer' };
  if (layerId.startsWith('mc-gimg-lyr-')) return { kind: 'groundImage' };
  return null;
}

/**
 * Records the key of a layer that holds one overlay. A layer re-created for the same overlay
 * (a raster whose source changed, a style swap) keeps the place it had among equal zIndexes.
 */
export function rememberOverlayStackKey(map: object, layerId: string, kind: OverlayKind, zIndex = 0): OverlayStackKey {
  let keys = itemStackKeys.get(map);
  if (!keys) {
    keys = new Map();
    itemStackKeys.set(map, keys);
  }
  let sequence = keys.get(layerId)?.sequence;
  if (sequence == null) {
    sequence = (itemSequences.get(map) ?? 0) + 1;
    itemSequences.set(map, sequence);
  }
  const key: OverlayStackKey = { kind, zIndex, sequence };
  keys.set(layerId, key);
  return key;
}

/** The overlay is gone (not just its layer): a later one with the same id starts over. */
export function forgetOverlayStackKey(map: object, layerId: string): void {
  itemStackKeys.get(map)?.delete(layerId);
}

/** The beforeId that puts a new layer with this key in its place in the stack. */
export function overlayLayerBeforeId(map: maplibregl.Map, key: OverlayStackKey): string | undefined {
  return overlayStackBeforeId(currentLayerOrder(map) ?? [], (id) => overlayStackKeyOf(map, id), key);
}

/** Moves an existing layer of ours to its place (after its zIndex changed). */
export function moveLayerToStackPlace(map: maplibregl.Map, layerId: string, key: OverlayStackKey): void {
  const order = currentLayerOrder(map);
  if (!order || !order.includes(layerId)) return;
  const rest = order.filter((id) => id !== layerId);
  const beforeId = overlayStackBeforeId(rest, (id) => overlayStackKeyOf(map, id), key);
  const at = order.indexOf(layerId);
  const next = order[at + 1];
  if (next === beforeId) return; // already there: moveLayer would fire styledata for nothing
  map.moveLayer(layerId, beforeId);
}

// What each GeoJSON source was last given, keyed by the source object itself. A style swap
// replaces the source objects, so a lost source never matches and is written again.
const writtenFeatures = new WeakMap<object, readonly unknown[]>();

/**
 * `source.setData` that skips the write when the features are the same objects, in the same
 * order, as the last write to this very source.
 *
 * Renderers build a new feature object whenever an overlay changes, so identity is enough to
 * say "nothing changed". Skipping matters for the same reason as in
 * [bringMarkerLayersToFront]: a redundant setData puts the source back into "loading", the
 * next `styledata` then reads as "style not ready", and the resync on `idle` wrote it again.
 */
export function setSourceFeatures(
  source: { setData(data: GeoJSONSourceData): unknown },
  features: FeatureCollection['features'],
): void {
  const previous = writtenFeatures.get(source);
  if (
    previous &&
    previous.length === features.length &&
    previous.every((feature, i) => feature === features[i])
  ) {
    return;
  }
  source.setData({ type: 'FeatureCollection', features } as GeoJSONSourceData);
  writtenFeatures.set(source, [...features]);
}

export function metersToPixels(meters: number, latitude: number): number {
  return meters / 0.075 / Math.cos((latitude * Math.PI) / 180);
}

export function createPointFeatureCollection(point: GeoPoint): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
        properties: {},
      },
    ],
  };
}

export function createLineFeatureCollection(points: GeoPoint[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: points.map((p): Coordinate => [p.longitude, p.latitude]),
        },
        properties: {},
      },
    ],
  };
}

export function createPolygonFeatureCollection(state: PolygonState): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            state.points.map((p): Coordinate => [p.longitude, p.latitude]),
            ...state.holes.map((hole) => hole.map((p): Coordinate => [p.longitude, p.latitude])),
          ],
        },
        properties: {},
      },
    ],
  };
}

export function groundImageCoordinates(state: GroundImageState): Coordinate[] | null {
  const sw = state.bounds.southWest;
  const ne = state.bounds.northEast;
  if (!sw || !ne) return null;
  return [
    [sw.longitude, ne.latitude],
    [ne.longitude, ne.latitude],
    [ne.longitude, sw.latitude],
    [sw.longitude, sw.latitude],
  ];
}

export function createRasterSource(source: RasterLayerSource): SourceSpecification {
  switch (source.type) {
    case 'UrlTemplate':
      return {
        type: 'raster',
        tiles: [source.template],
        tileSize: source.tileSize ?? RasterLayerSource.DEFAULT_TILE_SIZE,
        minzoom: source.minZoom ?? 0,
        maxzoom: source.maxZoom ?? 22,
        scheme: source.scheme === TileScheme.TMS ? 'tms' : 'xyz',
        attribution: '',
      };
    case 'TileJson':
      return { type: 'raster', url: source.url };
    case 'ArcGisService': {
      const serviceUrl = source.serviceUrl.replace(/\/+$/, '');
      return { type: 'raster', tiles: [`${serviceUrl}/tile/{z}/{y}/{x}`] };
    }
  }
}
