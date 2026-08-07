import {
  AbstractPolylineOverlayRenderer,
  buildUnwrappedPolylinePath,
  type PolylineEntity,
  type PolylineManagerInterface,
  type PolylineState,
} from '@mapconductor/js-sdk-core';
import type { LineFeature } from '../helpers';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';
import {
  TomTomPolylineLayer,
  type TomTomActualPolyline,
} from './TomTomPolylineLayer';

export class TomTomPolylineOverlayRenderer extends AbstractPolylineOverlayRenderer<
  TomTomMapViewHolder,
  TomTomActualPolyline
> {
  readonly layer: TomTomPolylineLayer;
  readonly polylineManager: PolylineManagerInterface<TomTomActualPolyline>;

  constructor({
    layer,
    polylineManager,
    holder,
  }: {
    layer: TomTomPolylineLayer;
    polylineManager: PolylineManagerInterface<TomTomActualPolyline>;
    holder: TomTomMapViewHolder;
  }) {
    super(holder);
    this.layer = layer;
    this.polylineManager = polylineManager;
  }

  async createPolyline(state: PolylineState): Promise<TomTomActualPolyline | null> {
    if (state.points.length < 2) return null;
    return createTomTomLines(state, this.resolveZIndex(state));
  }

  async updatePolylineProperties({
    current,
  }: {
    polyline: TomTomActualPolyline;
    current: PolylineEntity<TomTomActualPolyline>;
    prev: PolylineEntity<TomTomActualPolyline>;
  }): Promise<TomTomActualPolyline | null> {
    return this.createPolyline(current.state);
  }

  async removePolyline(_entity: PolylineEntity<TomTomActualPolyline>): Promise<void> {
    // The source is rewritten from the remaining manager entities in onPostProcess().
  }

  override async onPostProcess(): Promise<void> {
    this.layer.draw(this.polylineManager.allEntities());
  }

  async redraw(): Promise<void> {
    await this.onPostProcess();
  }

  private resolveZIndex(state: PolylineState): number {
    if (state.zIndex !== 0) return state.zIndex;
    return typeof state.extra === 'number' ? state.extra : 0;
  }
}

function createTomTomLines(
  state: PolylineState,
  zIndex: number,
): TomTomActualPolyline {
  // Unwrapped path (longitudes continuous, may exceed ±180): TomTom GL renders
  // it seamlessly across the antimeridian without splitting.
  const path = buildUnwrappedPolylinePath(state.points, state.geodesic);
  if (path.length < 2) return [];

  const feature: LineFeature = {
    type: 'Feature',
    id: `polyline-${state.id}-0`,
    geometry: {
      type: 'LineString',
      coordinates: path.map((point) => [point.longitude, point.latitude]),
    },
    properties: {
      id: `polyline-${state.id}-0`,
      [TomTomPolylineLayer.Prop.STROKE_COLOR]: state.strokeColor,
      [TomTomPolylineLayer.Prop.STROKE_WIDTH]: state.strokeWidth,
      [TomTomPolylineLayer.Prop.Z_INDEX]: zIndex,
    },
  };
  return [feature];
}
