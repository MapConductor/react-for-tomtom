import type { GeoJSONSource, LayerSpecification } from 'maplibre-gl';
import type { PolygonEntity } from '@mapconductor/js-sdk-core';
import type {
  FeatureCollection,
  LineFeature,
  PolygonFeature,
} from '../helpers';
import { bringMarkerLayersToFront } from '../helpers';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';

export interface TomTomActualPolygon {
  readonly fillFeatures: PolygonFeature[];
  readonly outlineFeatures: LineFeature[];
}

export class TomTomPolygonLayer {
  static readonly Prop = {
    FILL_COLOR: 'fillColor',
    STROKE_COLOR: 'strokeColor',
    STROKE_WIDTH: 'strokeWidth',
    Z_INDEX: 'zIndex',
  } as const;

  private readonly holder: TomTomMapViewHolder;
  private readonly canEditStyle: () => boolean;
  readonly sourceId: string;
  readonly layerId: string;
  readonly outlineSourceId: string;
  readonly outlineLayerId: string;

  constructor({
    holder,
    canEditStyle,
    sourceId = 'polygon-fill-source',
    layerId = 'polygon-fill-layer',
    outlineSourceId = 'polygon-outline-source',
    outlineLayerId = 'polygon-outline-layer',
  }: {
    holder: TomTomMapViewHolder;
    canEditStyle: () => boolean;
    sourceId?: string;
    layerId?: string;
    outlineSourceId?: string;
    outlineLayerId?: string;
  }) {
    this.holder = holder;
    this.canEditStyle = canEditStyle;
    this.sourceId = sourceId;
    this.layerId = layerId;
    this.outlineSourceId = outlineSourceId;
    this.outlineLayerId = outlineLayerId;
  }

  draw(entities: PolygonEntity<TomTomActualPolygon>[]): boolean {
    if (!this.ensureStyleResources()) return false;

    const ordered = [...entities].sort((a, b) => a.state.zIndex - b.state.zIndex);
    const fillData: FeatureCollection = {
      type: 'FeatureCollection',
      features: ordered.flatMap((entity) => entity.polygon.fillFeatures),
    };
    const outlineData: FeatureCollection = {
      type: 'FeatureCollection',
      features: ordered.flatMap((entity) => entity.polygon.outlineFeatures),
    };

    try {
      const fillSource = this.holder.map.getSource(this.sourceId) as GeoJSONSource | undefined;
      const outlineSource = this.holder.map.getSource(this.outlineSourceId) as GeoJSONSource | undefined;
      if (!fillSource || !outlineSource) return false;

      fillSource.setData(fillData);
      outlineSource.setData(outlineData);
      return true;
    } catch {
      return false;
    }
  }

  private ensureStyleResources(): boolean {
    const map = this.holder.map;
    const needsSetup =
      !map.getSource(this.sourceId) ||
      !map.getSource(this.outlineSourceId) ||
      !map.getLayer(this.layerId) ||
      !map.getLayer(this.outlineLayerId);

    if (needsSetup && !this.canEditStyle()) return false;

    try {
      if (!map.getSource(this.sourceId)) {
        map.addSource(this.sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getSource(this.outlineSourceId)) {
        map.addSource(this.outlineSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(this.layerId)) {
        const beforeId = map.getLayer('polyline-layer')
          ? 'polyline-layer'
          : map.getLayer('mc-marker-layer')
            ? 'mc-marker-layer'
            : undefined;
        map.addLayer(
          {
            id: this.layerId,
            type: 'fill',
            source: this.sourceId,
            layout: {
              'fill-sort-key': ['get', TomTomPolygonLayer.Prop.Z_INDEX],
            },
            paint: {
              'fill-color': ['get', TomTomPolygonLayer.Prop.FILL_COLOR],
            },
          } as LayerSpecification,
          beforeId,
        );
      }
      if (!map.getLayer(this.outlineLayerId)) {
        const beforeId = map.getLayer('polyline-layer')
          ? 'polyline-layer'
          : map.getLayer('mc-marker-layer')
            ? 'mc-marker-layer'
            : undefined;
        map.addLayer(
          {
            id: this.outlineLayerId,
            type: 'line',
            source: this.outlineSourceId,
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
              'line-sort-key': ['get', TomTomPolygonLayer.Prop.Z_INDEX],
            },
            paint: {
              'line-color': ['get', TomTomPolygonLayer.Prop.STROKE_COLOR],
              'line-width': ['get', TomTomPolygonLayer.Prop.STROKE_WIDTH],
            },
          } as LayerSpecification,
          beforeId,
        );
      }
      bringMarkerLayersToFront(map);
    } catch {
      return false;
    }

    return (
      map.getSource(this.sourceId) != null &&
      map.getSource(this.outlineSourceId) != null &&
      map.getLayer(this.layerId) != null &&
      map.getLayer(this.outlineLayerId) != null
    );
  }
}
