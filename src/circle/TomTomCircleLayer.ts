import type {
  GeoJSONSource,
  LayerSpecification,
} from 'maplibre-gl';
import { type CircleEntity } from '@mapconductor/js-sdk-core';
import { bringMarkerLayersToFront, type FeatureCollection, type PolygonFeature } from '../helpers';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';

export type TomTomActualCircle = PolygonFeature & { id?: string | number };

export class TomTomCircleLayer {
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
  readonly strokeLayerId: string;

  constructor({
    holder,
    canEditStyle,
    sourceId = 'circle-source',
    layerId = 'circle-layer',
  }: {
    holder: TomTomMapViewHolder;
    canEditStyle: () => boolean;
    sourceId?: string;
    layerId?: string;
  }) {
    this.holder = holder;
    this.canEditStyle = canEditStyle;
    this.sourceId = sourceId;
    this.layerId = layerId;
    this.strokeLayerId = `${layerId}-stroke`;
  }

  draw(entities: CircleEntity<TomTomActualCircle>[]): boolean {
    if (!this.ensureStyleResources()) return false;

    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: entities.map((entity) => entity.circle),
    };

    try {
      const source = this.holder.map.getSource(this.sourceId) as GeoJSONSource | undefined;
      if (!source) return false;
      source.setData(data);
      return true;
    } catch {
      return false;
    }
  }

  private ensureStyleResources(): boolean {
    const map = this.holder.map;
    const needsSetup =
      !map.getSource(this.sourceId) ||
      !map.getLayer(this.layerId) ||
      !map.getLayer(this.strokeLayerId);
    if (needsSetup && !this.canEditStyle()) return false;

    try {
      if (!map.getSource(this.sourceId)) {
        map.addSource(this.sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      const beforeId = map.getLayer('polygon-fill-layer')
        ? 'polygon-fill-layer'
        : map.getLayer('polyline-layer')
          ? 'polyline-layer'
          : map.getLayer('mc-marker-layer')
            ? 'mc-marker-layer'
            : undefined;
      if (!map.getLayer(this.layerId)) {
        map.addLayer(
          {
            id: this.layerId,
            type: 'fill',
            source: this.sourceId,
            layout: {
              'fill-sort-key': ['get', TomTomCircleLayer.Prop.Z_INDEX],
            },
            paint: {
              'fill-color': ['get', TomTomCircleLayer.Prop.FILL_COLOR],
            },
          } as LayerSpecification,
          beforeId,
        );
      }
      if (!map.getLayer(this.strokeLayerId)) {
        // Added with the same beforeId after the fill layer, so it renders
        // directly above the fill layer.
        map.addLayer(
          {
            id: this.strokeLayerId,
            type: 'line',
            source: this.sourceId,
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
              'line-sort-key': ['get', TomTomCircleLayer.Prop.Z_INDEX],
            },
            paint: {
              'line-color': ['get', TomTomCircleLayer.Prop.STROKE_COLOR],
              'line-width': ['get', TomTomCircleLayer.Prop.STROKE_WIDTH],
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
      map.getLayer(this.layerId) != null &&
      map.getLayer(this.strokeLayerId) != null
    );
  }
}
