import type * as maplibregl from 'maplibre-gl';
import type { SourceSpecification } from 'maplibre-gl';
import { createGeoPoint, TileScheme, type GeoPoint, type GroundImageState, type PolygonState, RasterLayerSource } from '@mapconductor/js-sdk-core';

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

export function bringMarkerLayersToFront(map: maplibregl.Map): void {
  for (const layerId of ['mc-raster-lyr-mc-marker-tiles', 'mc-marker-layer', 'mc-marker-drag-layer']) {
    try {
      if (map.getLayer(layerId)) map.moveLayer(layerId);
    } catch {
      continue;
    }
  }
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
