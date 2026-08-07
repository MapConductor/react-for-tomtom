import type { GeoJSONSource, LayerSpecification } from 'maplibre-gl';
import type { PolylineEntity } from '@mapconductor/js-sdk-core';
import { bringMarkerLayersToFront, type FeatureCollection, type LineFeature } from '../helpers';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';

export type TomTomActualPolyline = LineFeature[];

export class TomTomPolylineLayer {
  static readonly Prop = {
    STROKE_COLOR: 'strokeColor',
    STROKE_WIDTH: 'strokeWidth',
    Z_INDEX: 'zIndex',
  } as const;

  private readonly holder: TomTomMapViewHolder;
  private readonly canEditStyle: () => boolean;
  readonly sourceId: string;
  readonly layerId: string;

  constructor({
    holder,
    canEditStyle,
    sourceId = 'polyline-source',
    layerId = 'polyline-layer',
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
  }

  draw(entities: PolylineEntity<TomTomActualPolyline>[]): boolean {
    if (!this.ensureStyleResources()) return false;

    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: entities.flatMap((entity) => entity.polyline),
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
    const needsSetup = !map.getSource(this.sourceId) || !map.getLayer(this.layerId);
    if (needsSetup && !this.canEditStyle()) return false;

    try {
      if (!map.getSource(this.sourceId)) {
        map.addSource(this.sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(this.layerId)) {
        map.addLayer(
          {
            id: this.layerId,
            type: 'line',
            source: this.sourceId,
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': ['get', TomTomPolylineLayer.Prop.STROKE_COLOR],
              'line-width': ['get', TomTomPolylineLayer.Prop.STROKE_WIDTH],
            },
          } as LayerSpecification,
          map.getLayer('mc-marker-layer') ? 'mc-marker-layer' : undefined,
        );
      }
      bringMarkerLayersToFront(map);
    } catch {
      return false;
    }

    return map.getSource(this.sourceId) != null && map.getLayer(this.layerId) != null;
  }
}
