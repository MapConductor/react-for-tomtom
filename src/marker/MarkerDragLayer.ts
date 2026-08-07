import type { GeoPoint, MarkerEntity } from '@mapconductor/js-sdk-core';
import type { FeatureCollection } from '../helpers';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';
import {
  MarkerLayer,
  type TomTomActualMarker,
} from './MarkerLayer';

export class MarkerDragLayer extends MarkerLayer {
  selected: MarkerEntity<TomTomActualMarker> | null = null;

  constructor({
    holder,
    canEditStyle,
    sourceId,
    layerId,
  }: {
    holder: TomTomMapViewHolder;
    canEditStyle: () => boolean;
    sourceId: string;
    layerId: string;
  }) {
    super({ holder, canEditStyle, sourceId, layerId });
  }

  updatePosition(position: GeoPoint): boolean {
    const selected = this.selected;
    if (!selected) return false;

    const coordinates = selected.marker?.geometry.coordinates;
    const changed =
      coordinates == null ||
      coordinates[0] !== position.longitude ||
      coordinates[1] !== position.latitude;

    if (!selected.state.position.equals(position)) {
      selected.state.position = position;
    }
    if (!changed) return false;

    if (selected.marker) {
      selected.marker = {
        ...selected.marker,
        id: selected.state.id,
        geometry: {
          type: 'Point',
          coordinates: [position.longitude, position.latitude],
        },
        properties: { ...selected.marker.properties },
      };
    }
    return true;
  }

  drawSelected(): boolean {
    if (!this.ensureStyleResources()) return false;

    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: this.selected?.marker ? [this.selected.marker] : [],
    };
    return this.setData(data);
  }
}
